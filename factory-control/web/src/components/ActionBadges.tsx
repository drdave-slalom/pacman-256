import type { Attention } from "@maze/factory-control-shared";
import { attentionBadges } from "../state/selectors";

export function ActionBadges({ attention }: { attention: readonly Attention[] }) {
  const badges = attentionBadges(attention);
  if (badges.length === 0) return null;
  return (
    <div className="badges">
      {badges.map((badge) => (
        <span key={badge.key} className={`badge badge-${badge.tone}`} title={badge.label}>
          <span className="badge-glyph">{badge.glyph}</span> {badge.label}
        </span>
      ))}
    </div>
  );
}
