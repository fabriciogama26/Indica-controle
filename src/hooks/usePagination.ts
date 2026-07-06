"use client";

import { useMemo, useState } from "react";

export interface UsePaginationOptions {
  initialPage?: number;
  pageSize: number;
}

export function usePagination({ initialPage = 1, pageSize }: UsePaginationOptions) {
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(0);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  function next() {
    setPage((current) => Math.min(totalPages, current + 1));
  }

  function prev() {
    setPage((current) => Math.max(1, current - 1));
  }

  function reset() {
    setPage(1);
    setTotal(0);
  }

  return {
    page,
    pageSize,
    total,
    totalPages,
    canPrev,
    canNext,
    setPage,
    setTotal,
    next,
    prev,
    reset,
  };
}
