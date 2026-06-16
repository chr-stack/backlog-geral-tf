import * as XLSX from "xlsx";

export interface Ticket {
  id: string;
  status: string;
  sla: Date | null;
  requestedAt: Date | null;
  updatedAt: Date | null;
  assignee: string;
  reason: string;
  subject: string;
  channel: string;
  group: string;
  orderNumber: string;
  ageDays: number;
  bucket: AgeBucket;
  slaStatus: "Vencido" | "No prazo" | "—";
}

export type AgeBucket = "0-2" | "3-10" | "11-30" | "31-59" | "60+";

export const BUCKETS: AgeBucket[] = ["0-2", "3-10", "11-30", "31-59", "60+"];

export const BUCKET_LABEL: Record<AgeBucket, string> = {
  "0-2": "0 a 2 dias",
  "3-10": "3 a 10 dias",
  "11-30": "11 a 30 dias",
  "31-59": "31 a 59 dias",
  "60+": "60+ dias",
};

function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date
    const utc = Math.round((v - 25569) * 86400 * 1000);
    return new Date(utc);
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function bucketize(days: number): AgeBucket {
  if (days <= 2) return "0-2";
  if (days <= 10) return "3-10";
  if (days <= 30) return "11-30";
  if (days <= 59) return "31-59";
  return "60+";
}

export function parseWorkbook(buf: ArrayBuffer): { tickets: Ticket[]; referenceDate: Date } {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  // Use max(updatedAt) as reference "today" so demo data shows realistic ages.
  const updatedDates = rows
    .map((r) => toDate(r["Atualizado"]))
    .filter((d): d is Date => !!d);
  const refDate =
    updatedDates.length > 0
      ? new Date(Math.max(...updatedDates.map((d) => d.getTime())))
      : new Date();

  const tickets: Ticket[] = rows.map((r) => {
    const requestedAt = toDate(r["Data da solicitação"]);
    const sla = toDate(r["SLA"]);
    const ageDays = requestedAt
      ? Math.max(0, Math.floor((refDate.getTime() - requestedAt.getTime()) / 86400000))
      : 0;
    const slaStatus: Ticket["slaStatus"] = sla
      ? sla.getTime() < refDate.getTime()
        ? "Vencido"
        : "No prazo"
      : "—";
    const group = String(r["Grupo"] ?? "").trim() || "—";
    let reason = String(r["Motivo de Contato "] ?? r["Motivo de Contato"] ?? "").trim() || "—";
    if (group === "Lojas/Franquias" && (reason === "" || reason === "—")) {
      reason = "Análise de Lojas";
    }
    return {
      id: String(r["ID"] ?? ""),
      status: String(r["Status"] ?? "").trim() || "—",
      sla,
      requestedAt,
      updatedAt: toDate(r["Atualizado"]),
      assignee: String(r["Atribuído"] ?? "").trim() || "Sem atribuição",
      reason,
      subject: String(r["Assunto"] ?? "").trim(),
      channel: String(r["[TF] Canal de Atendimento"] ?? "").trim() || "—",
      group,
      orderNumber: String(r["Nº Pedido"] ?? "").trim(),
      ageDays,
      bucket: bucketize(ageDays),
      slaStatus,
    };
  });

  return { tickets, referenceDate: refDate };
}

export function groupCount<T extends string>(items: Ticket[], key: (t: Ticket) => T) {
  const map = new Map<T, number>();
  for (const t of items) map.set(key(t), (map.get(key(t)) ?? 0) + 1);
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}
