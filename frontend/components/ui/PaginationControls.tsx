"use client";

import type { PaginatedResponse } from "@/lib/types";

export function PaginationControls<T>({
  page,
  pageSize,
  data,
  onPageChange
}: {
  page: number;
  pageSize: number;
  data: PaginatedResponse<T>;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(data.count / pageSize));
  return (
    <div className="pagination-bar">
      <span>
        {data.count} registro(s) | página {page} de {totalPages}
      </span>
      <div>
        <button className="button ghost" disabled={!data.previous} type="button" onClick={() => onPageChange(Math.max(1, page - 1))}>
          Anterior
        </button>
        <button className="button ghost" disabled={!data.next} type="button" onClick={() => onPageChange(page + 1)}>
          Próxima
        </button>
      </div>
    </div>
  );
}
