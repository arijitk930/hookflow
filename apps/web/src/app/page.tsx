import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FlaskConical,
  LayoutDashboard,
  Plus,
  Settings2,
  Webhook,
} from "lucide-react";

const deliveries = [
  {
    id: "evt_8f21a",
    event: "payment.succeeded",
    endpoint: "api.acme.com/webhooks",
    status: "Succeeded",
    code: "200",
    time: "12:42:08",
    duration: "124 ms",
  },
  {
    id: "evt_7c10b",
    event: "order.created",
    endpoint: "api.shop.dev/hooks",
    status: "Failed",
    code: "500",
    time: "12:40:51",
    duration: "503 ms",
  },
  {
    id: "evt_6d93e",
    event: "customer.updated",
    endpoint: "api.acme.com/webhooks",
    status: "Succeeded",
    code: "200",
    time: "12:38:14",
    duration: "86 ms",
  },
  {
    id: "evt_5a42f",
    event: "invoice.paid",
    endpoint: "billing.example.com/events",
    status: "Retrying",
    code: "429",
    time: "12:35:22",
    duration: "201 ms",
  },
  {
    id: "evt_4b81c",
    event: "subscription.created",
    endpoint: "api.shop.dev/hooks",
    status: "Succeeded",
    code: "204",
    time: "12:32:09",
    duration: "97 ms",
  },
];

// Only Overview exists today; the rest render as disabled until their routes ship.
const navigation = [
  { label: "Overview", icon: LayoutDashboard, href: "/" },
  { label: "Endpoints", icon: Webhook, href: null },
  { label: "Events & Deliveries", icon: Activity, href: null },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0b1020] text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/8 bg-[#0d1324] p-5 lg:block">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500 text-white shadow-lg shadow-violet-500/20">
            <Webhook size={22} />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">HookFlow</p>
            <p className="text-xs text-slate-500">Webhook infrastructure</p>
          </div>
        </Link>

        <div className="mt-10">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Workspace
          </p>
          {navigation.map(({ label, icon: Icon, href }) =>
            href ? (
              <Link
                key={label}
                href={href}
                aria-current="page"
                className="mb-1 flex items-center gap-3 rounded-lg bg-violet-500/15 px-3 py-2.5 text-sm font-medium text-violet-300"
              >
                <Icon size={18} />
                {label}
              </Link>
            ) : (
              <ComingSoonNavItem key={label} label={label} icon={<Icon size={18} />} />
            ),
          )}
        </div>

        <div className="mt-9">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Configuration
          </p>
          <ComingSoonNavItem label="Settings" icon={<Settings2 size={18} />} />
        </div>

        <div className="absolute bottom-5 left-5 right-5 rounded-xl border border-white/8 bg-white/3 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-slate-500" />
            Not connected
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            API, queue and delivery worker health will appear here.
          </p>
        </div>
      </aside>

      <section className="lg:pl-64">
        <header className="flex h-16 items-center justify-between border-b border-white/8 px-5 sm:px-8">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="hidden sm:inline">Workspace</span>
            <span className="hidden sm:inline">/</span>
            <span className="font-medium text-white">Overview</span>
          </div>
        </header>

        <div className="mx-auto max-w-350 p-5 sm:p-8">
          <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/6 p-4 text-sm">
            <FlaskConical size={18} className="mt-0.5 shrink-0 text-amber-300" />
            <p className="text-amber-100/90">
              <span className="font-semibold">Demo data.</span>{" "}
              <span className="text-amber-100/70">
                Every number, chart and delivery on this page is illustrative. The
                HookFlow API isn&apos;t connected yet.
              </span>
            </p>
          </div>

          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Delivery overview
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Monitor events, delivery attempts and endpoint health.
              </p>
            </div>
            <button
              disabled
              title="Coming soon"
              className="flex cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-violet-500/50 px-4 py-2.5 text-sm font-semibold text-white/70"
            >
              <Plus size={17} />
              Create endpoint
            </button>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Total deliveries"
              value="12,840"
              change="+12.8%"
              positive
              icon={<Activity size={19} />}
            />
            <Metric
              label="Success rate"
              value="98.42%"
              change="+1.4%"
              positive
              icon={<CheckCircle2 size={19} />}
            />
            <Metric
              label="Failed deliveries"
              value="37"
              change="+4 today"
              positive={false}
              icon={<CircleAlert size={19} />}
            />
            <Metric
              label="Avg. response time"
              value="142 ms"
              change="-8.2%"
              positive
              icon={<Clock3 size={19} />}
            />
          </div>

          <div className="mt-8 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <section className="rounded-xl border border-white/8 bg-[#101729] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Delivery activity</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Delivery volume over the last 14 days
                  </p>
                </div>
              </div>

              <div className="mt-7 flex h-44 items-end gap-3 sm:gap-5">
                {[48, 68, 56, 83, 65, 93, 76, 61, 87, 70, 96, 79, 88, 63].map(
                  (height, index) => (
                    <div
                      key={index}
                      className="group flex h-full flex-1 items-end"
                    >
                      <div
                        style={{ height: `${height}%` }}
                        className="w-full rounded-t-sm bg-violet-500/70 transition group-hover:bg-violet-400"
                      />
                    </div>
                  ),
                )}
              </div>
              <div className="mt-3 flex justify-between border-t border-white/[0.07] pt-3 text-[11px] text-slate-500">
                <span>14 days ago</span>
                <span>7 days ago</span>
                <span>Today</span>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                Illustrative chart · Live analytics coming soon
              </p>
            </section>

            <section className="rounded-xl border border-white/8 bg-[#101729] p-5">
              <h2 className="font-semibold">Endpoint health</h2>
              <p className="mt-1 text-xs text-slate-500">
                Status of registered destinations
              </p>

              <div className="mt-6 flex items-center gap-5">
                <div className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-12 border-emerald-400/80">
                  <div className="absolute -inset-3 rounded-full border-12 border-transparent border-r-amber-400/80 border-b-amber-400/80" />
                  <div className="text-center">
                    <p className="text-2xl font-semibold">8</p>
                    <p className="text-[10px] text-slate-500">Endpoints</p>
                  </div>
                </div>
                <div className="space-y-4 text-sm">
                  <Legend color="bg-emerald-400" label="Healthy" value="6" />
                  <Legend color="bg-amber-400" label="Degraded" value="2" />
                  <Legend color="bg-slate-600" label="Disabled" value="0" />
                </div>
              </div>
              <button
                disabled
                title="Coming soon"
                className="mt-6 w-full cursor-not-allowed rounded-lg border border-white/10 py-2.5 text-sm text-slate-500"
              >
                View endpoints
              </button>
            </section>
          </div>

          <section className="mt-8 overflow-hidden rounded-xl border border-white/8 bg-[#101729]">
            <div className="flex flex-col justify-between gap-3 border-b border-white/8 p-5 sm:flex-row sm:items-center">
              <div>
                <h2 className="font-semibold">Recent deliveries</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Latest webhook delivery attempts
                </p>
              </div>
              <span className="text-sm text-slate-500">
                Full delivery log coming soon
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-190 text-left text-sm">
                <thead className="bg-white/2 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Event</th>
                    <th className="px-5 py-3 font-medium">Endpoint</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">HTTP</th>
                    <th className="px-5 py-3 font-medium">Duration</th>
                    <th className="px-5 py-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id} className="transition hover:bg-white/2.5">
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-200">{delivery.event}</p>
                        <p className="mt-1 font-mono text-[10px] text-slate-500">
                          {delivery.id}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-slate-400">{delivery.endpoint}</td>
                      <td className="px-5 py-4">
                        <Status value={delivery.status} />
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-400">
                        {delivery.code}
                      </td>
                      <td className="px-5 py-4 text-slate-400">{delivery.duration}</td>
                      <td className="px-5 py-4 text-slate-500">{delivery.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="py-8 text-center text-xs text-slate-600">
            HookFlow · Webhook infrastructure for developers
          </footer>
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  change,
  positive,
  icon,
}: {
  label: string;
  value: string;
  change: string;
  positive: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-[#101729] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300">
          {icon}
        </div>
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-tight">{value}</p>
      <div className="mt-2 flex items-center gap-1 text-xs">
        {positive ? (
          <ArrowUpRight size={14} className="text-emerald-400" />
        ) : (
          <ArrowDownRight size={14} className="text-rose-400" />
        )}
        <span className={positive ? "text-emerald-400" : "text-rose-400"}>
          {change}
        </span>
        <span className="text-slate-500">vs. previous period</span>
      </div>
    </div>
  );
}

function ComingSoonNavItem({
  label,
  icon,
}: {
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <span
      aria-disabled="true"
      className="mb-1 flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-500"
    >
      {icon}
      {label}
      <span className="ml-auto rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
        Soon
      </span>
    </span>
  );
}

function Status({ value }: { value: string }) {
  const styles: Record<string, string> = {
    Succeeded: "bg-emerald-400/10 text-emerald-400",
    Failed: "bg-rose-400/10 text-rose-400",
    Retrying: "bg-amber-400/10 text-amber-400",
  };

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${styles[value] ?? ""}`}>
      {value}
    </span>
  );
}

function Legend({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="text-slate-400">{label}</span>
      <span className="ml-auto font-medium text-slate-200">{value}</span>
    </div>
  );
}
