import csv
import io
import json
from heapq import heappop, heappush
from math import ceil, cos, hypot, radians
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import Window
import requests

DATA = Path(__file__).resolve().parents[1] / 'public' / 'data'
DTM = ('https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/'
       'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif')
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


def route_leg(terrain, slope, start, finish, slope_penalty):
    # Each graph edge samples the original 1 m raster along its full length.
    moves = [(x, y) for x in (-STEP, 0, STEP) for y in (-STEP, 0, STEP) if x or y]
    queue = [(0, start)]
    parents, costs = {}, {start: 0}

    def edge(a, b):
        xs = np.rint(np.linspace(a[0], b[0], STEP + 2)).astype(int)
        ys = np.rint(np.linspace(a[1], b[1], STEP + 2)).astype(int)
        grades = slope[ys, xs]
        return hypot((b[0] - a[0]) * EAST_SCALE, b[1] - a[1]), grades

    # A scalar cache avoids duplicating raster sampling across search edges.
    def allowed(a, b):
        x, y = a
        u, v = b
        return max(slope[y, x], slope[v, u], slope[(v+y)//2, (u+x)//2]) <= 25

    while queue:
        _, point = heappop(queue)
        if point == finish:
            break
        for dx, dy in moves:
            neighbor = (point[0] + dx, point[1] + dy)
            if not inside(neighbor) or not allowed(point, neighbor):
                continue
            distance, grades = edge(point, neighbor)
            if grades.max() > 25:
                continue
            cost = costs[point] + distance * (1 + slope_penalty * float(grades.mean()))
            if cost >= costs.get(neighbor, float('inf')):
                continue
            costs[neighbor], parents[neighbor] = cost, point
            x, y = neighbor
            heuristic = hypot((finish[0] - x) * EAST_SCALE, finish[1] - y)
            heappush(queue, (cost + heuristic, neighbor))
    else:
        raise RuntimeError(f'No route from {start} to {finish}')

    path = [finish]
    while path[-1] != start:
        path.append(parents[path[-1]])
    path.reverse()
    distance = climb = max_slope = minutes = 0
    clocks = [0]
    for a, b in zip(path, path[1:]):
        length, grades = edge(a, b)
        distance += length
        climb += max(0, float(terrain[b[1], b[0]] - terrain[a[1], a[0]]))
        max_slope = max(max_slope, float(grades.max()))
        minutes += length * (1 + 0.035 * float(grades.mean())) / SPEED / 60
        clocks.append(round(minutes, 4))
    return {'points': path, 'clock': clocks, 'distance': round(distance, 1),
            'climb': round(climb, 1), 'slope': round(max_slope, 1), 'minutes': round(minutes, 4)}


def routes_for(terrain, slope):
    routes = []
    direct = [route_leg(terrain, slope, a, b, 0.06)
              for a, b in [(HOME, STOP_1), (STOP_1, STOP_2), (STOP_2, HOME)]]
    south = (944, 900)
    first = route_leg(terrain, slope, HOME, south, 0.06)
    second = route_leg(terrain, slope, south, STOP_1, 0.06)
    alternate = {
        'points': first['points'] + second['points'][1:],
        'clock': first['clock'] + [round(first['minutes'] + t, 4) for t in second['clock'][1:]],
        'slope': max(first['slope'], second['slope']),
        **{key: round(first[key] + second[key], 4) for key in ('minutes', 'climb', 'distance')},
    }
    routes.append({'name': 'Direct approach', 'legs': direct})
    routes.append({'name': 'South approach', 'legs': [alternate, *direct[1:]]})
    return routes


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    terrain = read_terrain()
    slope = save_map(terrain)
    lines, waypoints = rover_data()
    print('Sol 461:', [p for p in waypoints if p['sol'] == 461])
    result = {'width': WIDTH, 'height': HEIGHT, 'eastScale': EAST_SCALE, 'lines': lines,
              'waypoints': waypoints, 'weather': pressure_reading(), 'routes': routes_for(terrain, slope)}
    for route in result['routes']:
        print(route['name'], [(leg['distance'], leg['slope'], leg['minutes']) for leg in route['legs']])
    (DATA / 'map.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
