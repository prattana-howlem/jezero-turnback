import csv
import io
import json
from math import cos, radians
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window
import requests

from routing import WalkingGrid, export_reach, join_legs

DATA = Path(__file__).resolve().parents[1] / 'public' / 'data'
DTM = ('https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/'
       'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif')
ORTHO = ('https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/'
         'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif')
ROVER = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_'
MEDA = ('https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/'
        'data_calibrated_env/sol_0420_0539/sol_0461/')
RADIUS = 3396190
LATITUDE = 18.4587
WIDTH, HEIGHT = 1840, 1320
EAST_SCALE = cos(radians(LATITUDE))
LEFT = round(RADIUS * radians(77.395))
TOP = round(RADIUS * radians(18.470))
STEP = 4
SPEED = 0.7
HOME, STOP_1, STOP_2 = (1240, 920), (660, 672), (392, 580)


def get(url):
    response = requests.get(url, timeout=35)
    response.raise_for_status()
    return response


def pixel(coordinates):
    lon, lat = coordinates[:2]
    return [round(RADIUS * radians(lon) - LEFT, 1), round(TOP - RADIUS * radians(lat), 1)]


def inside(point):
    x, y = point
    return 0 <= x < WIDTH and 0 <= y < HEIGHT


def read_terrain():
    with rasterio.open(DTM) as source:
        row, col = source.index(LEFT, TOP)
        terrain = source.read(1, window=Window(col, row, WIDTH, HEIGHT), masked=True)
        if not np.isfinite(terrain.filled(np.nan)).all():
            raise RuntimeError('Jezero crop contains missing elevation')
        return terrain.data


def save_map(terrain):
    dy, dx = np.gradient(terrain, 1, EAST_SCALE)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    light = np.clip((0.61 + 0.55 * dx - 0.57 * dy) / np.sqrt(1 + dx**2 + dy**2), 0, 1)
    heights = np.clip((terrain - np.percentile(terrain, 5)) / 105, 0, 1)
    intensity = (48 + 155 * light + 28 * heights)[..., None]
    shaded = intensity * np.array([1.18, 0.88, 0.68]) + np.array([10, 7, 5])
    Image.fromarray(np.uint8(np.clip(shaded, 0, 255))).save(DATA / 'terrain.jpg', quality=91)
    palette = np.array([[49, 169, 129, 86], [245, 196, 92, 172], [228, 57, 71, 219]], dtype=np.uint8)
    Image.fromarray(palette[np.digitize(slope, [12, 25])]).save(DATA / 'slope.png', optimize=True)
    return slope


def save_orthophoto():
    with rasterio.open(ORTHO) as source:
        if source.res != (0.25, 0.25) or source.crs.to_string() != 'ESRI:103885':
            raise RuntimeError(f'Unexpected HiRISE orthophoto georeferencing: {source.crs} {source.res}')
        row, col = source.index(LEFT, TOP)
        if source.transform * (col, row) != (LEFT, TOP):
            raise RuntimeError('Orthophoto and elevation grids are not aligned')
        photo = source.read(1, window=Window(col, row, WIDTH * 4, HEIGHT * 4),
                            out_shape=(HEIGHT * 2, WIDTH * 2), resampling=Resampling.average)
    if np.any(photo == 0):
        raise RuntimeError('Jezero orthophoto crop contains gaps')
    black, white = np.percentile(photo, [1, 99])
    contrasted = np.interp(photo, [black, white], [32, 243]).astype(np.uint8)
    Image.fromarray(contrasted).save(DATA / 'hirise.jpg', quality=91, optimize=True)


def rover_data():
    lines = get(ROVER + 'traverse.json').json()['features']
    segments = []
    for feature in lines:
        points = [pixel(point) for point in feature['geometry']['coordinates']]
        if any(inside(point) for point in points):
            segments.append(points)
    points = get(ROVER + 'waypoints.json').json()['features']
    waypoints = []
    for feature in points:
        point = pixel(feature['geometry']['coordinates'])
        info = feature['properties']
        if inside(point) and info.get('final') == 'y':
            waypoints.append({'point': point, 'sol': info['sol'], 'rmc': info['RMC']})
    return segments, waypoints


def pressure_reading():
    url = MEDA + 'WE__0461___________CAL_PS__________________P01.CSV'
    reader = csv.DictReader(io.StringIO(get(url).text))
    row = next(reader)
    return {'source': url, 'sol': 461, 'date': '2022-06-06',
            'localTime': row['LMST'].split('M')[1][:8],
            'pressure': float(row['BAROCAP1_PRESSURE'])}


def routes_for(terrain, slope):
    grid = WalkingGrid(terrain, slope, STEP, EAST_SCALE, SPEED)
    direct = grid.solve([HOME, STOP_1, STOP_2, HOME], penalty=0.005)
    outbound = grid.solve([HOME, (944, 1012), STOP_1], penalty=0.11, limit=19)
    alternate = grid.solve([STOP_1, STOP_2, HOME], penalty=0.14, limit=21)
    routes = [
        {'name': 'Direct traverse', 'legs': direct},
        {'name': 'Southern detour', 'legs': [join_legs(*outbound), *alternate]},
    ]
    return routes, export_reach(grid, routes, HOME, DATA)


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    terrain = read_terrain()
    slope = save_map(terrain)
    save_orthophoto()
    routes, reach = routes_for(terrain, slope)
    lines, waypoints = rover_data()
    print('Sol 461:', [p for p in waypoints if p['sol'] == 461])
    result = {'width': WIDTH, 'height': HEIGHT, 'eastScale': EAST_SCALE, 'lines': lines,
              'waypoints': waypoints, 'weather': pressure_reading(), 'routes': routes, 'reach': reach}
    for route in result['routes']:
        print(route['name'], [(leg['distance'], leg['slope'], leg['minutes']) for leg in route['legs']])
    (DATA / 'map.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
