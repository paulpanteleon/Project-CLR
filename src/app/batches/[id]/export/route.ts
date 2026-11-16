import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { exportFileName, toCsv, toTable, toXlsx, type ExportRow } from "@/lib/export/decisions";

// Downloads a batch's screening decisions as CSV or Excel (ADR-0017). Any member of the batch can
// export. The database function returns rows only to members and audits every export.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(request: NextRequest, context: RouteContext<"/batches/[id]/export">) {
  const { id } = await context.params;
  const format = request.nextUrl.searchParams.get("format");
  if (!UUID.test(id)) return new Response("Batch not found.", { status: 404 });
  if (format !== "csv" && format !== "xlsx") {
    return new Response("Choose format=csv or format=xlsx.", { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return new Response("Sign-in is not set up.", { status: 500 });

  // Row-level security returns the batch only to its members.
  const { data: batch } = await supabase.from("batches").select("name").eq("id", id).maybeSingle();
  if (!batch) return new Response("Batch not found.", { status: 404 });

  const { data, error } = await supabase.rpc("batch_decision_export", { p_batch_id: id });
  if (error) {
    console.error("batch_decision_export failed:", error.message);
    return new Response("The export could not be made. Try again.", { status: 500 });
  }

  const table = toTable((data ?? []) as ExportRow[]);
  const body = format === "csv" ? toCsv(table) : toXlsx(table);
  const fileName = exportFileName(batch.name, format);

  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
