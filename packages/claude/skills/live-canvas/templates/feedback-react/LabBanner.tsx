// LabBanner — drop-in notice for the design lab page.
// Render once at the top of the lab page (above the variant grid).
// In a real /live-canvas run, the skill picks the mode based on what
// the user chose at Phase 0 and passes it via props.

import type { CSSProperties, FC } from 'react';

type Mode = 'live' | 'json';

interface LabBannerProps {
  mode: Mode;
}

const LIVE: CSSProperties = {
  background: '#ecfeff',
  border: '1px solid #06b6d4',
  color: '#0e7490',
};

const JSON_MODE: CSSProperties = {
  background: '#fefce8',
  border: '1px solid #facc15',
  color: '#854d0e',
};

const baseStyle: CSSProperties = {
  borderRadius: 8,
  padding: '10px 14px',
  margin: '12px 0',
  fontSize: 13,
  lineHeight: 1.5,
};

export const LabBanner: FC<LabBannerProps> = ({ mode }) => {
  const palette = mode === 'live' ? LIVE : JSON_MODE;
  return (
    <div role="note" style={{ ...baseStyle, ...palette }}>
      {mode === 'live' ? (
        <>
          <b>Live design lab — Live mode active.</b> Click any element → leave a
          comment → Save. Feedback streams into the Claude session running{' '}
          <code>live-claude</code>; Claude edits the corresponding{' '}
          <code>.claude-design/lab/variants/Variant&lt;X&gt;.tsx</code> file and
          your dev server hot-reloads. The lab is temporary and will be deleted
          on Finish.
        </>
      ) : (
        <>
          <b>Live design lab — JSON mode.</b> Click any element → leave a
          comment → Save. Comments accumulate locally; click <b>Submit</b> when
          done and either paste the JSON in your terminal or tell Claude
          "check". The lab is temporary and will be deleted on Finish.
        </>
      )}
    </div>
  );
};
