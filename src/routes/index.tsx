import { createFileRoute } from "@tanstack/react-router";
import { BacklogDashboard } from "@/components/BacklogDashboard";

export const Route = createFileRoute("/")({
  component: BacklogDashboard,
  head: () => ({
    meta: [
      { title: "Painel de Backlog · Atendimento" },
      { name: "description", content: "Visão consolidada do backlog por atendente, idade, SLA e motivos de contato." },
    ],
  }),
});
