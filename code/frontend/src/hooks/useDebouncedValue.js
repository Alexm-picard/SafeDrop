/**
 * Hold back a fast-changing value until it has been still for a moment.
 *
 * Built for the catalogue search (SCRUM-201), where every request may cost an AI call: typing
 * "camera" should send one search, not six.
 */
import { useEffect, useState } from 'react';
/**
 * Return `value` once it has stopped changing for `delayMs`.
 *
 * Each change restarts the timer, and the effect's cleanup clears the pending one, so only the last
 * value of a burst is ever returned — and nothing is set after the component unmounts.
 * @template T
 * @param {T} value the live value, e.g. an input's text
 * @param {number} delayMs how long it must stay unchanged
 * @returns {T} the settled value
 */
export function useDebouncedValue(value, delayMs) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
