import { useEffect, useState } from 'react';
import {
  jobDetailsSchema,
  reportSchema,
  scanEventSchema,
  type JobDetails,
  type AnalysisReport,
  type ScanEvent,
} from '@crawlspider/contracts';
import { apiUrl, request, clearCancellation, errorMessage } from './api.js';
export function useLiveJob(id: string) {
  const [job, setJob] = useState<JobDetails>(),
    [report, setReport] = useState<AnalysisReport>(),
    [events, setEvents] = useState<ScanEvent[]>([]),
    [error, setError] = useState(''),
    [connection, setConnection] = useState('Connecting…');
  useEffect(() => {
    setJob(undefined);
    setReport(undefined);
    setEvents([]);
    setError('');
    const controller = new AbortController();
    let source: EventSource | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      reconnect: ReturnType<typeof setTimeout> | undefined,
      busy = false,
      again = false,
      nextPoll = 2500,
      terminal = false,
      cursor = '0';
    const connect = () => {
      if (controller.signal.aborted || terminal) return;
      source = new EventSource(
        apiUrl(`/v1/scans/${encodeURIComponent(id)}/events?after=${cursor}`),
      );
      source.onopen = () => setConnection('Live updates connected');
      source.onmessage = (event) => {
        try {
          const parsed = scanEventSchema.parse(JSON.parse(event.data));
          if (parsed.jobId !== id || BigInt(parsed.id) <= BigInt(cursor)) return;
          cursor = parsed.id;
          setEvents((previous) => [...previous, parsed].slice(-40));
          void update();
        } catch {
          setConnection('Checking scan status');
        }
      };
      source.onerror = () => {
        source?.close();
        if (!terminal && !controller.signal.aborted) {
          setConnection('Live connection interrupted; checking status');
          reconnect = setTimeout(connect, 5000);
        }
      };
    };
    const update = async () => {
      if (busy) {
        again = true;
        return;
      }
      if (controller.signal.aborted || terminal) return;
      busy = true;
      try {
        const details = await request(`/v1/scans/${encodeURIComponent(id)}`, jobDetailsSchema, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJob(details);
        if (details.preview) setReport(details.preview);
        if (details.reportId) {
          const final = await request(`/v1/reports/${details.reportId}`, reportSchema, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (final.identity.mint !== details.mint || final.jobId !== id)
            throw new Error('Report does not match the scan.');
          setReport(final);
        }
        setError('');
        nextPoll = 2500;
        if (!['queued', 'running'].includes(details.state)) {
          terminal = true;
          source?.close();
          if (reconnect) clearTimeout(reconnect);
          clearCancellation(id);
          setConnection('Scan ended');
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(errorMessage(e));
          nextPoll = Math.min(nextPoll * 2, 30000);
          again = false;
        }
      } finally {
        busy = false;
        if (!controller.signal.aborted && !terminal) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(
            () => {
              again = false;
              void update();
            },
            again ? 100 : nextPoll,
          );
        }
      }
    };
    void update();
    connect();
    return () => {
      controller.abort();
      source?.close();
      if (timer) clearTimeout(timer);
      if (reconnect) clearTimeout(reconnect);
    };
  }, [id]);
  return { job, report, events, error, connection };
}
