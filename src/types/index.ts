export type MaybePromise<T> = T | Promise<T>

/** Union of an object type's values. */
export type ValueOf<T> = T[keyof T]

/** Union of an array or tuple's element types. */
export type ElementOf<T extends readonly unknown[]> = T[number]

export type NonEmptyArray<T> = [T, ...T[]]

/** Flattens intersections into one object type so hovers stay readable. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {}

export type Nullable<T> = T | null | undefined
