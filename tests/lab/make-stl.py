"""A small house as a binary STL, Z-up, in millimetres - like a CAD export.
Writes tests/lab/fixtures/house.stl for ai.mjs."""
import os
import struct

here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(here, 'fixtures'), exist_ok=True)

v = [(0, 0, 0), (10, 0, 0), (10, 8, 0), (0, 8, 0), (0, 0, 6), (10, 0, 6), (10, 8, 6), (0, 8, 6), (5, 0, 9), (5, 8, 9)]
faces = [(0, 2, 1), (0, 3, 2), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7),
         (4, 5, 8), (7, 9, 6), (5, 6, 9), (5, 9, 8), (4, 8, 9), (4, 9, 7)]

with open(os.path.join(here, 'fixtures', 'house.stl'), 'wb') as f:
    f.write(b'meARc lab house'.ljust(80, b' '))
    f.write(struct.pack('<I', len(faces)))
    for face in faces:
        f.write(struct.pack('<3f', 0, 0, 0))
        for i in face:
            f.write(struct.pack('<3f', *v[i]))
        f.write(struct.pack('<H', 0))
print('wrote fixtures/house.stl,', len(faces), 'triangles')
