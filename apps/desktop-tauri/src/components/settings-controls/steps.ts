type Step = Readonly<{ value: number }>;

/** Index of the step closest to a saved value, which may sit between stops
    (a Marquee width set by dragging its edges, say). */
export function nearestStepIndex(steps: ReadonlyArray<Step>, value: number): number {
  return steps.reduce((best, step, i) => {
    const bestStep = steps[best];
    return bestStep && Math.abs(step.value - value) < Math.abs(bestStep.value - value) ? i : best;
  }, 0);
}
