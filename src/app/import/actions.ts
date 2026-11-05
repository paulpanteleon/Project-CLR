"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { planPubmedImport } from "@/lib/pubmed/plan";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ImportState = { error: string | null };

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Imports a PubMed export into a new batch (S02, US-01). The file is checked here, and
// the database saves the batch, file, and records in one step (ADR-0010).
export async function importPubmedFile(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const sourceLabel = String(formData.get("source_label") ?? "");
  if (sourceLabel !== "public" && sourceLabel !== "confidential") {
    return { error: "Choose a data source label before importing." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a PubMed export file to import." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "This file is larger than 10 MB. Split the export and import each part." };
  }

  const text = await file.text();
  const plan = planPubmedImport(text);
  if (plan.error) {
    return { error: plan.error };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Sign-in is not set up yet. The Supabase settings are missing." };
  }

  const checksum = createHash("sha256").update(text, "utf8").digest("hex");
  const batchName = file.name.replace(/\.[^.]+$/, "") || "PubMed import";

  const { data: batchId, error } = await supabase.rpc("import_pubmed_batch", {
    p_batch_name: batchName,
    p_source_label: sourceLabel,
    p_file_name: file.name,
    p_file_text: text,
    p_checksum: checksum,
    p_records: plan.records.map((r) => ({
      pmid: r.pmid,
      doi: r.doi,
      title: r.title,
      abstract: r.abstract,
      authors: r.authors,
      journal: r.journal,
      year: r.year,
    })),
    p_rejected_count: plan.rejected.length,
    p_duplicate_count: plan.duplicates.length,
  });

  if (error || !batchId) {
    console.error("import_pubmed_batch failed:", error?.message);
    return { error: "The import did not save anything. Check that you can add records, then try again." };
  }

  // redirect() ends the request, so it must stay outside any try block.
  redirect(`/batches/${batchId}/summary`);
}
