export function SettingsSkeleton() {
  return (
    <div className="pane-loading" role="status" aria-live="polite" aria-label="Loading settings">
      <section className="group">
        <span className="group-title skeleton-line skeleton-title" />
        <div className="group-card">
          {[52, 44, 58].map((width) => (
            <div className="row skeleton-row" key={`appearance-${width}`}>
              <span className="row-label skeleton-line" style={{ width: `${width}%` }} />
              <span className="row-control skeleton-control">
                <span className="skeleton-line skeleton-pill" style={{ width: 44, height: 24, borderRadius: 24 }} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="group">
        <span className="group-title skeleton-line skeleton-title short" />
        <div className="group-card">
          {[60, 48].map((width) => (
            <div className="row skeleton-row" key={`surface-${width}`}>
              <span className="row-label skeleton-line" style={{ width: `${width}%` }} />
              <span className="row-control skeleton-control">
                <span className="skeleton-line" style={{ width: 120 }} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
