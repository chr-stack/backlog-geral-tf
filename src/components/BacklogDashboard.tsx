import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Clock,
  Flame,
  Inbox,
  Upload,
  Users,
  Search,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";
import defaultUrl from "@/assets/backlog-default.xlsx?url";
import {
  BUCKETS,
  BUCKET_LABEL,
  type AgeBucket,
  type Ticket,
  groupCount,
  parseWorkbook,
} from "@/lib/backlog";

const BUCKET_COLORS: Record<AgeBucket, string> = {
  "0-2": "var(--chart-4)",
  "3-10": "var(--chart-1)",
  "11-30": "var(--chart-2)",
  "31-59": "var(--chart-3)",
  "60+": "var(--chart-5)",
};

const STORAGE_KEY = "backlog:dataset:v1";

interface Dataset {
  tickets: Ticket[];
  referenceDate: Date;
  fileName: string;
}

function rehydrate(raw: string): Dataset | null {
  try {
    const o = JSON.parse(raw);
    return {
      fileName: o.fileName,
      referenceDate: new Date(o.referenceDate),
      tickets: o.tickets.map((t: Ticket) => ({
        ...t,
        sla: t.sla ? new Date(t.sla) : null,
        requestedAt: t.requestedAt ? new Date(t.requestedAt) : null,
        updatedAt: t.updatedAt ? new Date(t.updatedAt) : null,
      })),
    };
  } catch {
    return null;
  }
}

export function BacklogDashboard() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [bucketFilter, setBucketFilter] = useState<AgeBucket | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [reasonAgeFilter, setReasonAgeFilter] = useState<AgeBucket | "all">("all");
  const [reasonGroupFilter, setReasonGroupFilter] = useState<string>("all");

  useEffect(() => {
    const cached = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (cached) {
      const d = rehydrate(cached);
      if (d) {
        setData(d);
        setLoading(false);
        return;
      }
    }
    fetch(defaultUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const parsed = parseWorkbook(buf);
        setData({ ...parsed, fileName: "Backlog.xlsx (exemplo)" });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function handleFile(file: File) {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf);
      const ds: Dataset = { ...parsed, fileName: file.name };
      setData(ds);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ds));
      } catch {
        /* storage full – ignore */
      }
    } catch (e) {
      setError(`Não consegui ler o arquivo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.tickets.filter((t) => {
      if (bucketFilter !== "all" && t.bucket !== bucketFilter) return false;
      if (agentFilter !== "all" && t.assignee !== agentFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !t.id.toLowerCase().includes(q) &&
          !t.subject.toLowerCase().includes(q) &&
          !t.reason.toLowerCase().includes(q) &&
          !t.assignee.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [data, bucketFilter, agentFilter, search]);

  const stats = useMemo(() => {
    if (!data) return null;
    const all = data.tickets;
    const byBucket: Record<AgeBucket, number> = {
      "0-2": 0,
      "3-10": 0,
      "11-30": 0,
      "31-59": 0,
      "60+": 0,
    };
    for (const t of all) byBucket[t.bucket]++;
    const critical = all.filter((t) => t.bucket === "60+");
    const agents = Array.from(new Set(all.map((t) => t.assignee))).sort();

    const agentBuckets = Array.from(
      all.reduce((m, t) => {
        if (!m.has(t.assignee)) m.set(t.assignee, { name: t.assignee, total: 0 } as Record<string, number | string>);
        const row = m.get(t.assignee)!;
        (row[t.bucket] as number) = ((row[t.bucket] as number) ?? 0) + 1;
        (row.total as number) = (row.total as number) + 1;
        return m;
      }, new Map<string, Record<string, number | string>>())
        .values(),
    )
      .sort((a, b) => (b.total as number) - (a.total as number))
      .slice(0, 12);

    const topReasons = groupCount(all, (t) => t.reason).slice(0, 10).map((r) => r.name);
    const reasonBuckets = Array.from(
      all.reduce((m, t) => {
        if (!topReasons.includes(t.reason)) return m;
        if (!m.has(t.reason)) m.set(t.reason, { name: t.reason, total: 0 } as Record<string, number | string>);
        const row = m.get(t.reason)!;
        (row[t.bucket] as number) = ((row[t.bucket] as number) ?? 0) + 1;
        (row.total as number) = (row.total as number) + 1;
        return m;
      }, new Map<string, Record<string, number | string>>())
        .values(),
    )
      .sort((a, b) => (b.total as number) - (a.total as number));

    return {
      total: all.length,
      byBucket,
      critical,
      agents,
      byReason: groupCount(all, (t) => t.reason).slice(0, 5),
      byChannel: groupCount(all, (t) => t.channel),
      byStatus: groupCount(all, (t) => t.status),
      byGroup: groupCount(all, (t) => t.group),
      agentBuckets,
      reasonBuckets,
    };
  }, [data]);

  const reasonChartData = useMemo(() => {
    if (!data) return [];
    const pool = reasonAgeFilter === "all" ? data.tickets : data.tickets.filter((t) => t.bucket === reasonAgeFilter);
    const topReasons = groupCount(pool, (t) => t.reason).slice(0, 10).map((r) => r.name);
    return Array.from(
      pool.reduce((m, t) => {
        if (!topReasons.includes(t.reason)) return m;
        if (!m.has(t.reason)) m.set(t.reason, { name: t.reason, total: 0 } as Record<string, number | string>);
        const row = m.get(t.reason)!;
        (row[t.bucket] as number) = ((row[t.bucket] as number) ?? 0) + 1;
        (row.total as number) = (row.total as number) + 1;
        return m;
      }, new Map<string, Record<string, number | string>>())
        .values(),
    ).sort((a, b) => (b.total as number) - (a.total as number));
  }, [data, reasonAgeFilter]);

  const topReasonData = useMemo(() => {
    if (!data) return [];
    const pool = reasonGroupFilter === "all" ? data.tickets : data.tickets.filter((t) => t.group === reasonGroupFilter);
    return groupCount(pool, (t) => t.reason).slice(0, 5);
  }, [data, reasonGroupFilter]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Carregando painel…
      </div>
    );
  }

  if (!data || !stats) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <UploadCard
          onFile={handleFile}
          dragOver={dragOver}
          setDragOver={setDragOver}
          inputRef={inputRef}
          error={error}
          empty
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header */}
        <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Operações · Atendimento
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">
              Painel de Backlog
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Fonte: <span className="text-foreground">{data.fileName}</span> · Referência{" "}
              {data.referenceDate.toLocaleDateString("pt-BR")}
            </p>
          </div>
          <UploadCard
            onFile={handleFile}
            dragOver={dragOver}
            setDragOver={setDragOver}
            inputRef={inputRef}
            error={error}
            compact
          />
        </header>

        {/* KPIs */}
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3">
          <Kpi
            label="Tickets em backlog"
            value={stats.total}
            icon={<Inbox className="h-5 w-5" />}
          />
          <Kpi
            label="Críticos 60+ dias"
            value={stats.critical.length}
            icon={<Flame className="h-5 w-5" />}
            tone={stats.critical.length > 0 ? "danger" : "ok"}
          />
          <Kpi
            label="Atendentes ativos"
            value={stats.agents.length}
            icon={<Users className="h-5 w-5" />}
          />
        </div>

        {/* Age buckets */}
        <Section title="Idade do backlog" subtitle="Distribuição por faixa de dias em aberto">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {BUCKETS.map((b) => (
              <button
                key={b}
                onClick={() => setBucketFilter(bucketFilter === b ? "all" : b)}
                className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all ${
                  bucketFilter === b
                    ? "border-primary shadow-[var(--shadow-glow)]"
                    : "border-border hover:border-primary/50"
                }`}
                style={{ background: "var(--gradient-surface)" }}
              >
                <div
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: BUCKET_COLORS[b] }}
                />
                <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
                  {BUCKET_LABEL[b]}
                  {b === "60+" && <Flame className="h-4 w-4 text-destructive" />}
                </div>
                <div className="mt-3 text-4xl font-bold tabular-nums">
                  {stats.byBucket[b]}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {stats.total > 0
                    ? `${Math.round((stats.byBucket[b] / stats.total) * 100)}% do total`
                    : "—"}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {/* Critical alert */}
        {stats.critical.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 overflow-hidden rounded-2xl border border-destructive/40"
            style={{ background: "var(--gradient-danger)" }}
          >
            <div className="flex items-start gap-4 p-5">
              <AlertTriangle className="mt-0.5 h-6 w-6 text-destructive-foreground" />
              <div className="flex-1 text-destructive-foreground">
                <div className="text-lg font-semibold">
                  {stats.critical.length} tickets com 60+ dias precisam de atenção imediata
                </div>
                <div className="mt-1 text-sm opacity-90">
                  Tickets nessa faixa quase sempre indicam ruptura de processo ou cliente
                  esquecido. Reveja, escale ou feche.
                </div>
              </div>
              <button
                onClick={() => setBucketFilter("60+")}
                className="rounded-lg bg-background/20 px-4 py-2 text-sm font-medium text-destructive-foreground backdrop-blur-sm transition hover:bg-background/30"
              >
                Ver críticos →
              </button>
            </div>
          </motion.div>
        )}

        {/* Charts grid */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle>Backlog por atendente · faixa de idade</CardTitle>
            <div className="mt-4 h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.agentBuckets} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    width={130}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {BUCKETS.map((b) => (
                    <Bar
                      key={b}
                      dataKey={b}
                      stackId="a"
                      fill={BUCKET_COLORS[b]}
                      name={BUCKET_LABEL[b]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardTitle>Status</CardTitle>
            <div className="mt-4 h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.byStatus}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={3}
                  >
                    {stats.byStatus.map((_, i) => (
                      <Cell
                        key={i}
                        fill={`var(--chart-${(i % 5) + 1})`}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Top motivos de contato</CardTitle>
            </div>
            <div className="mb-3 mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Filtrar por grupo:</span>
              <select
                value={reasonGroupFilter}
                onChange={(e) => setReasonGroupFilter(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary"
              >
                <option value="all">Todos os grupos</option>
                {stats.byGroup.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topReasonData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    width={160}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 6, 6, 0]}>
                    <LabelList dataKey="value" position="insideRight" className="fill-primary-foreground text-[11px]" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardTitle>Canal de atendimento</CardTitle>
            <div className="mt-4 flex h-[320px] items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.byChannel} layout="vertical" margin={{ top: 30, bottom: 30, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    width={160}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="value" fill="var(--chart-2)" radius={[0, 6, 6, 0]}>
                    <LabelList dataKey="value" content={<ChannelLabel />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardTitle>Grupo</CardTitle>
            <div className="mt-4 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.byGroup}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={110}
                    paddingAngle={3}
                  >
                    {stats.byGroup.map((_, i) => (
                      <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Reason by age */}
        <Section
          title="Motivos de contato por idade do backlog"
          subtitle="Top motivos distribuídos por faixa de dias"
        >
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Filtrar por idade:</span>
              <select
                value={reasonAgeFilter}
                onChange={(e) => setReasonAgeFilter(e.target.value as AgeBucket | "all")}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary"
              >
                <option value="all">Todas as idades</option>
                {BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {BUCKET_LABEL[b]}
                  </option>
                ))}
              </select>
            </div>
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reasonChartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    width={180}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {BUCKETS.map((b) => (
                    <Bar
                      key={b}
                      dataKey={b}
                      stackId="a"
                      fill={BUCKET_COLORS[b]}
                      name={BUCKET_LABEL[b]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Section>

        {/* Filters + Table */}
        <Section
          title="Tickets"
          subtitle={`${filtered.length.toLocaleString("pt-BR")} de ${stats.total.toLocaleString("pt-BR")}`}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por ID, atendente, motivo, assunto…"
                className="w-72 rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary"
              />
            </div>
            <select
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value as AgeBucket | "all")}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="all">Todas as idades</option>
              {BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {BUCKET_LABEL[b]}
                </option>
              ))}
            </select>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="all">Todos atendentes</option>
              {stats.agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {(bucketFilter !== "all" || agentFilter !== "all" || search) && (
              <button
                onClick={() => {
                  setBucketFilter("all");
                  setAgentFilter("all");
                  setSearch("");
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Limpar
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Idade</th>
                    <th className="px-4 py-3 text-left">SLA</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Atendente</th>
                    <th className="px-4 py-3 text-left">Motivo</th>
                    <th className="px-4 py-3 text-left">Canal</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {filtered.slice(0, 500).map((t) => (
                      <motion.tr
                        key={t.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`border-t border-border transition hover:bg-muted/40 ${
                          t.bucket === "60+" ? "bg-destructive/5" : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{t.id}</td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                            style={{
                              background: `color-mix(in oklab, ${BUCKET_COLORS[t.bucket]} 18%, transparent)`,
                              color: BUCKET_COLORS[t.bucket],
                            }}
                          >
                            {t.bucket === "60+" && <Flame className="h-3 w-3" />}
                            {t.ageDays}d
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {t.slaStatus === "Vencido" ? (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <Clock className="h-3.5 w-3.5" /> Vencido
                            </span>
                          ) : t.slaStatus === "No prazo" ? (
                            <span className="inline-flex items-center gap-1 text-[oklch(0.75_0.18_145)]">
                              <CheckCircle2 className="h-3.5 w-3.5" /> No prazo
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{t.status}</td>
                        <td className="px-4 py-3">{t.assignee}</td>
                        <td className="px-4 py-3 text-muted-foreground">{t.reason}</td>
                        <td className="px-4 py-3 text-muted-foreground">{t.channel}</td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum ticket nesse filtro.
                </div>
              )}
              {filtered.length > 500 && (
                <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">
                  Mostrando 500 de {filtered.length}. Refine com filtros para ver mais.
                </div>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function ChannelLabel(props: any) {
  const { x, y, width, height, value } = props;
  const text = String(value);
  const approxTextWidth = text.length * 7;
  if (width < approxTextWidth + 10) {
    return (
      <text x={x + width + 6} y={y + height / 2} dy={3} fill="var(--foreground)" fontSize={11} textAnchor="start">
        {value}
      </text>
    );
  }
  return (
    <text x={x + width - 6} y={y + height / 2} dy={3} fill="var(--primary-foreground)" fontSize={11} textAnchor="end">
      {value}
    </text>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "ok" | "danger";
}) {
  const ring =
    tone === "danger"
      ? "border-destructive/40"
      : tone === "ok"
      ? "border-[oklch(0.75_0.18_145)]/30"
      : "border-border";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border ${ring} p-5`}
      style={{ background: "var(--gradient-surface)", boxShadow: "var(--shadow-elevated)" }}
    >
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums">
        {value.toLocaleString("pt-BR")}
      </div>
    </motion.div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-border p-5 ${className}`}
      style={{ background: "var(--gradient-surface)" }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

function UploadCard({
  onFile,
  dragOver,
  setDragOver,
  inputRef,
  error,
  compact = false,
  empty = false,
}: {
  onFile: (f: File) => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  error: string | null;
  compact?: boolean;
  empty?: boolean;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`group flex items-center gap-3 rounded-2xl border border-dashed transition ${
        dragOver ? "border-primary bg-primary/10" : "border-border bg-card/50"
      } ${compact ? "px-4 py-3" : "w-full max-w-lg flex-col p-10 text-center"}`}
    >
      <Upload className={compact ? "h-5 w-5 text-primary" : "h-10 w-10 text-primary"} />
      <div className={compact ? "flex-1" : ""}>
        <div className={compact ? "text-sm font-medium" : "text-lg font-semibold"}>
          {empty ? "Comece enviando seu Backlog.xlsx" : "Atualizar arquivo"}
        </div>
        {!compact && (
          <div className="mt-1 text-sm text-muted-foreground">
            Arraste e solte aqui ou clique para selecionar. O arquivo é processado localmente.
          </div>
        )}
      </div>
      <button
        onClick={() => inputRef.current?.click()}
        className="rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
      >
        Selecionar arquivo
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}
    </div>
  );
}
