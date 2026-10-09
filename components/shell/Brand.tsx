/** Brandmark + wordmark: the violet tile with a serif "N", and "NewsBrief" in Newsreader. */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-[26px] place-items-center rounded-[7px] bg-accent-fill font-serif text-[15px] font-bold leading-none text-on-accent"
      >
        N
      </span>
      <span className="font-serif text-[21px] font-semibold leading-none tracking-[-0.01em]">NewsBrief</span>
    </span>
  )
}
