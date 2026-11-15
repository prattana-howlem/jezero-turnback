"""Route solving and reach-and-return fields on the Jezero elevation mosaic."""

from math import hypot
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra


class WalkingGrid:
    def __init__(self, terrain, slope, step, east_scale, speed):
        self.terrain = terrain
        self.step = step
        self.rows, self.cols = slope[::step, ::step].shape
        self.size = self.rows * self.cols
        nodes = np.arange(self.size).reshape(self.rows, self.cols)
        yy, xx = np.indices(nodes.shape)
        edges = []
        for dx, dy in [(1, 0), (0, 1), (1, 1), (-1, 1)]:
            valid = (xx + dx >= 0) & (xx + dx < self.cols) & (yy + dy < self.rows)
            x, y = xx[valid], yy[valid]
            offsets = np.linspace(0, step, step + 2)
            grades = slope[
                np.rint(y[:, None] * step + dy * offsets).astype(int),
                np.rint(x[:, None] * step + dx * offsets).astype(int),
            ]
            maximum = grades.max(axis=1)
            valid = maximum <= 25
            length = hypot(dx * step * east_scale, dy * step)
            edges.append((nodes[y, x][valid], nodes[y+dy, x+dx][valid],
                          np.full(valid.sum(), length), grades[valid].mean(axis=1), maximum[valid]))
        self.start, self.finish, self.length, self.grade, self.maximum = (
            np.concatenate(parts) for parts in zip(*edges)
        )
        self.minutes = self.length * (1 + 0.035 * self.grade) / speed / 60
        self.travel = self.matrix(self.minutes)
        self.length_matrix = self.matrix(self.length)
        self.slope_matrix = self.matrix(self.maximum)

    def matrix(self, weights, limit=25):
        keep = self.maximum <= limit
        start, finish, values = self.start[keep], self.finish[keep], weights[keep]
        return coo_matrix(
            (np.concatenate((values, values)), (np.r_[start, finish], np.r_[finish, start])),
            shape=(self.size, self.size),
        ).tocsr()

    def node(self, point):
        x, y = (int(p) // self.step for p in point)
        return y * self.cols + x

    def solve(self, stops, *, penalty, limit=25):
        weights = self.matrix(self.length * (1 + penalty * self.grade), limit)
        return [self.leg(weights, a, b) for a, b in zip(stops, stops[1:])]

    def leg(self, weights, start, finish):
        a, b = self.node(start), self.node(finish)
        cost, parents = dijkstra(weights, indices=a, return_predecessors=True)
        if not np.isfinite(cost[b]):
            raise ValueError(f'No walkable route between {start} and {finish}')
        nodes = [b]
        while nodes[-1] != a:
            nodes.append(int(parents[nodes[-1]]))
        nodes = np.array(nodes[::-1])
        x, y = (nodes % self.cols) * self.step, (nodes // self.cols) * self.step
        segments = (nodes[:-1], nodes[1:])
        lengths = np.asarray(self.length_matrix[segments]).ravel()
        durations = np.asarray(self.travel[segments]).ravel()
        slopes = np.asarray(self.slope_matrix[segments]).ravel()
        heights = self.terrain[y, x]
        return {
            'points': np.column_stack((x, y)).tolist(),
            'clock': np.round(np.r_[0, durations.cumsum()], 5).tolist(),
            'elevation': np.round(heights.astype(float), 2).tolist(),
            'meters': np.round(np.r_[0, lengths.cumsum()], 2).tolist(),
            'distance': round(float(lengths.sum()), 2),
            'minutes': round(float(durations.sum()), 5),
            'climb': round(float(np.maximum(np.diff(heights), 0).sum()), 2),
            'slope': round(float(slopes.max()), 1),
        }


def join_legs(first, second):
    joined = {key: first[key] + second[key][1:] for key in ('points', 'elevation')}
    for field, total in [('clock', 'minutes'), ('meters', 'distance')]:
        joined[field] = first[field] + [round(first[total] + value, 5) for value in second[field][1:]]
    joined.update({key: round(first[key] + second[key], 5) for key in ('minutes', 'distance', 'climb')})
    joined['slope'] = max(first['slope'], second['slope'])
    return joined


def export_reach(grid, routes, home, folder):
    # Solve on the same 4 m graph as the route, then sample it for map rendering.
    stride = 3
    samples = np.arange(grid.size).reshape(grid.rows, grid.cols)[::stride, ::stride]
    home_cost = dijkstra(grid.travel, indices=grid.node(home))[samples]
    grid.terrain[::stride * grid.step, ::stride * grid.step].astype('<f4').tofile(
        Path(folder) / 'surface.bin'
    )
    field_ids = {}
    coverage_file = Path(folder) / 'reach.bin'
    with coverage_file.open('wb') as output:
        np.minimum(np.ceil(home_cost * 100), 65535).astype('<u2').tofile(output)
        for route in routes:
            for leg in route['legs']:
                clock = np.array(leg['clock'])
                targets = np.r_[np.arange(0, clock[-1], 1.5), clock[-1]]
                indices = np.unique(np.searchsorted(clock, targets))
                leg['reach'] = []
                for index in indices:
                    node = grid.node(leg['points'][index])
                    if node not in field_ids:
                        field_ids[node] = len(field_ids) + 1
                        field = dijkstra(grid.travel, indices=node)[samples]
                        np.minimum(np.ceil(field * 100), 65535).astype('<u2').tofile(output)
                    leg['reach'].append([clock[index], field_ids[node]])
    return {'rows': samples.shape[0], 'cols': samples.shape[1],
            'step': stride * grid.step, 'fields': len(field_ids) + 1}
