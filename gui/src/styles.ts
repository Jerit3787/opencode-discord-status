export const presenceStyles = `
.ods-stack {
  display: grid;
  gap: 12px;
}

.ods-card {
  background: var(--v2-background-bg-layer-01);
  box-shadow: inset 0 0 0 0.5px var(--v2-border-border-muted);
  border-radius: 8px;
  overflow: hidden;
}

.ods-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 12px;
}

.ods-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--v2-text-text-base);
}

.ods-muted {
  font-size: 11px;
  color: var(--v2-text-text-muted);
}

.ods-status {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
}

.ods-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  margin-top: 5px;
  background: var(--v2-text-text-muted);
}

.ods-dot--on {
  background: var(--v2-state-fg-success, #3fb950);
}

.ods-dot--warn {
  background: var(--v2-state-fg-warning, #d29922);
}

.ods-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 20px;
  margin-top: 12px;
}

.ods-meta-label {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--v2-text-text-muted);
}

.ods-meta-value {
  font-size: 12px;
  color: var(--v2-text-text-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ods-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-top: 0.5px solid var(--v2-border-border-muted);
}

.ods-row:first-child {
  border-top: 0;
}

.ods-row-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ods-row-title {
  font-size: 12px;
  color: var(--v2-text-text-base);
}

.ods-row-desc {
  font-size: 11px;
  color: var(--v2-text-text-muted);
}

.ods-preview {
  margin: 0 20px 20px;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--v2-background-bg-layer-02);
  border: 0.5px solid var(--v2-border-border-muted);
  display: grid;
  gap: 4px;
}

.ods-preview--off {
  opacity: 0.6;
}

.ods-preview-line {
  font-size: 12px;
  color: var(--v2-text-text-base);
}

.ods-preview-line--state {
  color: var(--v2-text-text-muted);
}

.ods-preview-elapsed {
  font-size: 11px;
  color: var(--v2-text-text-muted);
  font-variant-numeric: tabular-nums;
}

.ods-preview-elapsed--off {
  opacity: 0.5;
}

.ods-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--v2-background-bg-layer-02);
  color: var(--v2-text-text-muted);
  white-space: nowrap;
}

.ods-badge--off {
  color: var(--v2-state-fg-warning, #d29922);
}

.ods-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--v2-background-bg-layer-01);
  box-shadow: inset 0 0 0 0.5px var(--v2-border-border-muted);
  font-size: 11px;
  color: var(--v2-text-text-muted);
}

.ods-notice--error {
  color: var(--v2-state-fg-danger, #f85149);
}

.ods-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 4px;
}

.ods-path {
  flex: 1;
  min-width: 0;
  font-family: var(--v2-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--v2-text-text-muted);
  word-break: break-all;
}
`
