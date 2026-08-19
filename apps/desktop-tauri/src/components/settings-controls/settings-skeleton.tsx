const GROUP_CLASS = 'group flex flex-col gap-2';
const GROUP_TITLE_CLASS = 'group-title skeleton-line skeleton-title m-0 ml-3';
const ROW_CLASS = 'row skeleton-row flex min-h-14 items-center justify-between box-border px-4 py-1.5 text-[13.5px]';
const ROW_LABEL_CLASS = 'row-label skeleton-line flex-1';
const ROW_CONTROL_CLASS = 'row-control skeleton-control flex items-center gap-3';

export function SettingsSkeleton() {
  return (
    <div className="pane-loading flex flex-col gap-7" role="status" aria-live="polite" aria-label="Loading settings">
      <section className={GROUP_CLASS}>
        <span className={GROUP_TITLE_CLASS} />
        <div className="group-card">
          {[52, 44, 58].map((width) => (
            <div className={ROW_CLASS} key={`appearance-${width}`}>
              <span className={ROW_LABEL_CLASS} style={{ width: `${width}%` }} />
              <span className={ROW_CONTROL_CLASS}>
                <span className="skeleton-line skeleton-pill" style={{ width: 44, height: 24, borderRadius: 24 }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={GROUP_CLASS}>
        <span className={`${GROUP_TITLE_CLASS} short`} />
        <div className="group-card">
          {[60, 48].map((width) => (
            <div className={ROW_CLASS} key={`surface-${width}`}>
              <span className={ROW_LABEL_CLASS} style={{ width: `${width}%` }} />
              <span className={ROW_CONTROL_CLASS}>
                <span className="skeleton-line" style={{ width: 120 }} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
