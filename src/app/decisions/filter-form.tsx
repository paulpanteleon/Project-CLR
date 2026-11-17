"use client";

import Form from "next/form";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import type { DecisionFilters } from "@/lib/decisions";

export type FilterOption = { value: string; label: string };

// The search and filters for the Decisions page (S10, US-09). It submits as a plain GET, so each
// search has its own address that can be bookmarked or shared with someone in the same batches.
export function FilterForm({
  filters,
  batches,
  outcomes,
  reviewers,
  reasons,
}: {
  filters: DecisionFilters;
  batches: FilterOption[];
  outcomes: FilterOption[];
  reviewers: FilterOption[];
  reasons: FilterOption[];
}) {
  // The fields keep their own values while typing. A new search rebuilds the form, so the fields
  // start from that search's values (after Search, Clear, or the browser's Back button).
  return (
    <Form action="/decisions" key={JSON.stringify(filters)}>
      <Stack spacing={2}>
        <TextField
          name="q"
          label="PubMed ID, title or author"
          defaultValue={filters.query ?? ""}
          size="small"
          fullWidth
          helperText="A PubMed ID must match exactly. Title and author match any part, in any case."
        />
        <Grid container spacing={2}>
          <Choice name="batch" label="Batch" value={filters.batchId} options={batches} />
          <Choice name="outcome" label="Outcome" value={filters.outcome} options={outcomes} />
          <Choice name="reviewer" label="Decided by" value={filters.reviewerId} options={reviewers} />
          <Choice name="reason" label="Reason" value={filters.reasonCode} options={reasons} />
        </Grid>
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained">
            Search
          </Button>
          <Button href="/decisions" color="inherit">
            Clear
          </Button>
        </Stack>
      </Stack>
    </Form>
  );
}

function Choice({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | null;
  options: FilterOption[];
}) {
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <TextField name={name} label={label} select size="small" fullWidth defaultValue={value ?? ""}>
        <MenuItem value="">Any</MenuItem>
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    </Grid>
  );
}
