const cron = require('node-cron');

const jobs = new Map();

/**
 * Schedule a recurring job using a cron expression.
 * Requirements: 9.1, 16.4
 */
function scheduleNightlyJob(jobName, cronTime, handler) {
  const task = cron.schedule(cronTime, async () => {
    const startTime = new Date().toISOString();
    console.log(`[Scheduler] Job started: ${jobName} at ${startTime}`);
    try {
      await handler();
      console.log(`[Scheduler] Job completed: ${jobName} at ${new Date().toISOString()}`);
      const entry = jobs.get(jobName);
      if (entry) { entry.lastRun = new Date(); entry.status = 'success'; }
    } catch (error) {
      console.error(`[Scheduler] Job failed: ${jobName}`, { error: error.message, stack: error.stack });
      const entry = jobs.get(jobName);
      if (entry) { entry.status = 'failed'; }
    }
  });

  jobs.set(jobName, { task, isActive: true, lastRun: null, status: 'pending', cronTime });
  console.log(`[Scheduler] Scheduled job: ${jobName} (${cronTime})`);
}

function cancelJob(jobName) {
  const entry = jobs.get(jobName);
  if (!entry) return false;
  entry.task.stop();
  entry.isActive = false;
  return true;
}

function getJobStatus(jobName) {
  const entry = jobs.get(jobName);
  if (!entry) return null;
  return { jobName, isActive: entry.isActive, lastRun: entry.lastRun, status: entry.status };
}

module.exports = { scheduleNightlyJob, cancelJob, getJobStatus };
