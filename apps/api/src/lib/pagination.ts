import type { PaginationMeta } from "@community-os/shared/validators";

export function paginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return {
    total,
    page,
    limit,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

export function listOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function paginatedResult<K extends string, T>(
  key: K,
  data: T[],
  page: number,
  limit: number,
  total: number,
): { [P in K]: T[] } & PaginationMeta {
  return {
    [key]: data,
    ...paginationMeta(page, limit, total),
  } as { [P in K]: T[] } & PaginationMeta;
}
