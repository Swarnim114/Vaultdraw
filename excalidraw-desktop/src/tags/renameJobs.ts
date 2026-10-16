/**
 * Rewrite jobs started by a tag rename. The links wiring's generic
 * "Updated N links" toast skips them: the tag flow reports its own message.
 */
const jobs = new Set<number>();

export const claimTagJob = (jobId: number) => void jobs.add(jobId);
export const releaseTagJob = (jobId: number) => void jobs.delete(jobId);
export const isTagJob = (jobId: number) => jobs.has(jobId);
