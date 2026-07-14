import { VoxelShape } from "../../src/base/aabb";

const shape = [
    {
        "maxX": 1,
        "maxY": 1,
        "maxZ": 0.5,
        "minX": 0,
        "minY": 0,
        "minZ": 0
    },
    {
        "maxX": 1,
        "maxY": 1,
        "maxZ": 1,
        "minX": 0,
        "minY": 0.5,
        "minZ": 0.5
    }
]
    .map(val => VoxelShape.fromBox(val))
    .reduce((prev, curr) => VoxelShape.or(prev, curr), VoxelShape.Empty);

// console.log(shape.isFullWide(0, 0, 0));
// console.log(shape.isFullWide(0, 0, 1));
// console.log(shape.isFullWide(0, 1, 0));
// console.log(shape.isFullWide(0, 1, 1));
