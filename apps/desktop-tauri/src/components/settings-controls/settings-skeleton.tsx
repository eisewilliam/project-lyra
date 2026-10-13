const GROUP_TITLE_CLASS = 'group-title skeleton-line skeleton-title';
const ROW_LABEL_CLASS = 'row-label skeleton-line';
const ROW_CONTROL_CLASS = 'row-control skeleton-control';

export function SettingsSkeleton() {
  return (
    <div className="pane-loading" role="status" aria-live="polite" aria-label="Loading settings">
      <section className="group">
        <span className={GROUP_TITLE_CLASS} />
        <div className="group-rows">
          {[52, 44, 58].map((width) => (
            <div className="row skeleton-row" key={`appearance-${width}`}>
              <span className={ROW_LABEL_CLASS} style={{ maxWidth: `${width}%` }} />
              <span className={ROW_CONTROL_CLASS}>
                <span className="skeleton-line skeleton-pill" />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="group">
        <span className={`${GROUP_TITLE_CLASS} short`} />
        <div className="group-rows">
          {[60, 48].map((width) => (
            <div className="row skeleton-row" key={`surface-${width}`}>
              <span className={ROW_LABEL_CLASS} style={{ maxWidth: `${width}%` }} />
              <span className={ROW_CONTROL_CLASS}>
                <span className="skeleton-line skeleton-bar" />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
