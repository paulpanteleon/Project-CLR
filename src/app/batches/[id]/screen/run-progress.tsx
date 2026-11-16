"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export type RunRow = {
  id: string;
  model_label: string;
  status: string;
  total: number;
  proposed: number;
  unreadable: number;
  failed: number;
  last_error: string | null;
  started_at: string;
};

const REFRESH_MS = 5_000;

const STATUS_COLORS: Record<string, "info" | "success" | "error"> = {
  running: "info",
  finished: "success",
  failed: "error",
};

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  finished: "Finished",
  failed: "Stopped",
};

// Shows the latest background runs (ADR-0018). While one is running, the page refreshes every few
// seconds so the counts move without a reload.
export function RunProgress({ runs }: { runs: RunRow[] }) {
  const router = useRouter();
  const anyRunning = runs.some((run) => run.status === "running");

  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [anyRunning, router]);

  if (runs.length === 0) return null;

  return (
    <Stack spacing={2} sx={{ mt: 3 }}>
      {runs.map((run) => {
        const done = run.proposed + run.unreadable + run.failed;
        const percent = run.total === 0 ? 100 : Math.min(100, Math.round((done / run.total) * 100));
        return (
          <Stack key={run.id} spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {run.model_label}
              </Typography>
              <Chip size="small" color={STATUS_COLORS[run.status]} label={STATUS_LABELS[run.status] ?? run.status} />
              <Typography variant="body2" color="text.secondary">
                {done} of {run.total} records · {run.proposed} proposed · {run.unreadable} unreadable · {run.failed}{" "}
                failed · started {new Date(run.started_at).toISOString().replace("T", " ").slice(0, 16)} UTC
              </Typography>
            </Stack>
            {run.status === "running" && <LinearProgress variant="determinate" value={percent} />}
            {run.last_error && run.status !== "finished" && (
              <Typography variant="body2" color="error">
                {run.last_error}
              </Typography>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}
