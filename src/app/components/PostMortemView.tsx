import { Card } from "./ui";
import type { RunState } from "./types";

export function PostMortemView({ run }: { run: RunState }) {
  const pm = run.postmortem;
  const generating = run.status === "generating_postmortem";

  if (!pm && !generating) return null;

  return (
    <Card title="Post-Mortem" step={8} accent="#a5b4fc">
      {generating && !pm && (
        <p className="text-sm text-white/50">
          Writing post-mortem and updating memory…
        </p>
      )}

      {pm && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs text-white/50">
              {pm.postmortem_id}
            </span>
            <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-300">
              Quality {pm.quality_score}/100
            </span>
            {pm.incident_updated && (
              <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                ✓ Saved to Memory
              </span>
            )}
          </div>

          <Markdown text={pm.postmortem_text} />

          {pm.action_items.length > 0 && (
            <Section title="Action Items" items={pm.action_items} />
          )}
          {pm.prevention_recommendations.length > 0 && (
            <Section
              title="Prevention Recommendations"
              items={pm.prevention_recommendations}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-white/40">
        {title}
      </p>
      <ul className="list-inside list-disc space-y-1 text-sm text-white/75">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

/** Minimal markdown renderer for the post-mortem subset (##, -, paragraphs). */
function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flushList = (key: string) => {
    if (list.length === 0) return;
    blocks.push(
      <ul
        key={key}
        className="mb-3 list-inside list-disc space-y-1 text-sm text-white/75"
      >
        {list.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^##\s/.test(line)) {
      flushList(`l${idx}`);
      blocks.push(
        <h3
          key={idx}
          className="mb-1.5 mt-4 text-sm font-bold uppercase tracking-wide text-white/80 first:mt-0"
        >
          {line.replace(/^##\s/, "")}
        </h3>
      );
    } else if (/^[-*]\s/.test(line)) {
      list.push(line.replace(/^[-*]\s/, ""));
    } else if (line.trim() === "") {
      flushList(`l${idx}`);
    } else {
      flushList(`l${idx}`);
      blocks.push(
        <p key={idx} className="mb-3 text-sm leading-relaxed text-white/75">
          {inline(line)}
        </p>
      );
    }
  });
  flushList("last");

  return <div className="rounded-lg border border-white/10 bg-black/20 p-4">{blocks}</div>;
}

/** Render inline **bold** segments. */
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={i} className="font-semibold text-white/90">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}
