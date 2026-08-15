/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FactHeader } from "../../components/molecules/FactHeader";
import { useAuth } from "../../contexts/AuthContext";
import { apiFetch } from "../../utils/apiClient";
import {
  correctionCaptureMethod,
  correctionDate,
  effectiveHistoryEntry,
  historyMessage,
  localCalendarDate,
  plannedFact,
  projectTimestampPresentation,
  timelinePresentation,
  type ProgressHistoryLoadState,
  type ProgressTimelineEvent,
} from "../../utils/progressActual";

type HistoryEntry = {
  id: string;
  installedQuantity: string;
  workDate: string | null;
  recordedAt: string;
  captureMethod: string;
  status: string;
  correctionReason: string | null;
  evidenceReferences: Array<{ url: string; label: string }>;
  revision: number;
  timeline?: ProgressTimelineEvent[];
};
type CorrectionDraft = {
  entryId: string;
  commandId: string;
  installedQuantity: string;
  workDate: string;
  captureMethod: string;
  reason: string;
};

export function SubmitProgressPage() {
  const { projectId, boqItemId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [quantity, setQuantity] = useState("");
  const [workDate, setWorkDate] = useState(localCalendarDate);
  const [notes, setNotes] = useState("");
  const [captureMethod, setCaptureMethod] = useState("FIELD_OBSERVATION");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [boqItem, setBoqItem] = useState<any>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyState, setHistoryState] = useState<ProgressHistoryLoadState>({
    kind: "loading",
  });
  const [effectiveEntryId, setEffectiveEntryId] = useState<string | null>(null);
  const [projectTimeZone, setProjectTimeZone] = useState<string | null>(null);
  const [actions, setActions] = useState({
    verify: false,
    correct: false,
    accept: false,
  });
  const [transitionCommands, setTransitionCommands] = useState<
    Record<string, string>
  >({});
  const [correction, setCorrection] = useState<CorrectionDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!projectId || !boqItemId) return;
    setHistoryState({ kind: "loading" });
    try {
      const response = await apiFetch(
        `/projects/${projectId}/progress/items/${boqItemId}/history`,
      );
      if (!response.ok)
        return setHistoryState({
          kind: "error",
          message: `Riwayat Actual gagal dimuat (${response.status}).`,
        });
      const body = await response.json();
      const entries = body.entries ?? [];
      setHistory(entries);
      setEffectiveEntryId(body.effectiveEntryId ?? null);
      setProjectTimeZone(body.projectTimeZone ?? null);
      setActions(
        body.availableActions ?? {
          verify: false,
          correct: false,
          accept: false,
        },
      );
      setHistoryState({ kind: "loaded", count: entries.length });
    } catch {
      setHistoryState({
        kind: "error",
        message: "Riwayat Actual gagal dimuat karena gangguan jaringan.",
      });
    }
  }, [projectId, boqItemId]);

  useEffect(() => {
    if (!token || !projectId || !boqItemId) return;
    apiFetch(`/projects/${projectId}/progress/monitoring`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Data pekerjaan gagal dimuat (${response.status}).`);
        const data = await response.json();
        const item = (data.items ?? []).find(
          (candidate: any) =>
            candidate.id === boqItemId && candidate.itemType === "WORK_ITEM",
        );
        if (!item)
          throw new Error("Pekerjaan tidak ditemukan pada proyek ini.");
        setBoqItem(item);
        setProjectTimeZone(data.projectTimeZone ?? null);
      })
      .catch((error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Data pekerjaan gagal dimuat.",
        ),
      );
    void loadHistory();
  }, [token, projectId, boqItemId, loadHistory]);

  const send = async (path: string, payload: unknown) => {
    const response = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        Array.isArray(body.message)
          ? body.message.join(", ")
          : body.message || "Perintah gagal disimpan",
      );
    }
    return response.json();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !boqItemId || !quantity || !workDate) return;
    setSubmitting(true);
    setNotice(null);
    try {
      await send(`/projects/${projectId}/progress/field`, {
        commandId,
        entries: [
          {
            boqItemId,
            installedQuantity: quantity,
            workDate,
            captureMethod,
            notes: notes || undefined,
            evidenceReferences: evidenceUrl.trim()
              ? [{ url: evidenceUrl.trim(), label: "Bukti lapangan" }]
              : undefined,
          },
        ],
      });
      setCommandId(crypto.randomUUID());
      setNotice("Actual tersimpan dan dapat dibaca kembali dari Monitoring.");
      await loadHistory();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Perintah gagal disimpan",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const transition = async (
    entry: HistoryEntry,
    action: "verify" | "accept",
  ) => {
    if (!projectId) return;
    const key = `${entry.id}:${action}`;
    const stableId = transitionCommands[key] ?? crypto.randomUUID();
    setTransitionCommands((value) => ({ ...value, [key]: stableId }));
    setSubmitting(true);
    try {
      await send(
        `/projects/${projectId}/progress/entries/${entry.id}/${action}`,
        { commandId: stableId },
      );
      setTransitionCommands((value) => {
        const next = { ...value };
        delete next[key];
        return next;
      });
      await loadHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Perintah gagal");
    } finally {
      setSubmitting(false);
    }
  };

  const saveCorrection = async () => {
    if (!projectId || !correction?.reason.trim()) return;
    setSubmitting(true);
    try {
      await send(
        `/projects/${projectId}/progress/entries/${correction.entryId}/corrections`,
        {
          commandId: correction.commandId,
          installedQuantity: correction.installedQuantity,
          workDate: correction.workDate,
          captureMethod: correction.captureMethod,
          reason: correction.reason.trim(),
        },
      );
      setCorrection(null);
      setNotice("Koreksi baru tersimpan. Actual lama tetap ada dalam riwayat.");
      await loadHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Koreksi gagal");
    } finally {
      setSubmitting(false);
    }
  };

  const planned = plannedFact(boqItem);
  const effective = effectiveHistoryEntry(history, effectiveEntryId);
  const stateMessage = historyMessage(historyState);
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        background: "white",
        padding: "var(--space-8)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <button onClick={() => navigate(`/field/project/${projectId}`)}>
        &larr; Kembali
      </button>
      <h2>Catat Actual Lapangan</h2>
      {notice && <p role="status">{notice}</p>}
      {boqItem && (
        <section>
          <h3>
            {boqItem.wbsCode} — {boqItem.name}
          </h3>
          <FactHeader
            label="Volume rencana"
            value={planned.quantity ?? "Tidak tersedia"}
            suffix={planned.unit ?? undefined}
            certaintyLevel="C5"
            showBadge={false}
          />
          {effective && (
            <p>
              <strong>Actual efektif:</strong> {effective.installedQuantity}{" "}
              {planned.unit ?? ""} · {effective.status}
            </p>
          )}
        </section>
      )}
      <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
        <label>
          Tanggal pekerjaan
          <input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            required
          />
        </label>
        <label>
          Volume Actual ({planned.unit ?? "satuan"})
          <input
            type="number"
            min="0"
            step="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <label>
          Sumber pencatatan
          <select
            value={captureMethod}
            onChange={(e) => setCaptureMethod(e.target.value)}
          >
            <option value="FIELD_OBSERVATION">Pengamatan lapangan</option>
            <option value="FIELD_MEASUREMENT">Pengukuran lapangan</option>
            <option value="DOCUMENT_REFERENCE">Referensi dokumen</option>
          </select>
        </label>
        <label>
          Catatan
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <fieldset>
          <legend>Bukti opsional</legend>
          <label>
            URL referensi
            <input
              type="url"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
            />
          </label>
          <small>
            Referensi disimpan apa adanya; SIMPROK tidak mengklaim file telah
            diverifikasi.
          </small>
        </fieldset>
        <button type="submit" disabled={submitting}>
          Simpan Actual
        </button>
      </form>
      <section>
        <h3>Riwayat Actual</h3>
        <small>
          {projectTimeZone
            ? `Waktu proyek: ${projectTimeZone}`
            : "Zona waktu proyek belum ditetapkan; waktu ditampilkan dalam UTC."}
        </small>
        {stateMessage && (
          <p role={historyState.kind === "error" ? "alert" : undefined}>
            {stateMessage}
          </p>
        )}
        {historyState.kind === "loaded" &&
          history.map((entry) => {
            const recordedAt = projectTimestampPresentation(
              entry.recordedAt,
              projectTimeZone,
            );
            return (
              <article key={entry.id}>
                <strong>
                  Revisi {entry.revision}: {entry.installedQuantity}{" "}
                  {planned.unit ?? ""}
                </strong>
                <div>
                  {entry.status} · {recordedAt.occurredAtLabel} (
                  {recordedAt.timeZoneBasis}) · {entry.captureMethod}
                </div>
                {entry.correctionReason && (
                  <p>Alasan koreksi: {entry.correctionReason}</p>
                )}
                {entry.evidenceReferences.map((e) => (
                  <a key={e.url} href={e.url} target="_blank" rel="noreferrer">
                    {e.label}
                  </a>
                ))}
                {entry.timeline?.map((event) => {
                  const eventTime = timelinePresentation(
                    event,
                    projectTimeZone,
                  );
                  return (
                    <div key={eventTime.key}>
                      <small>
                        {event.action} · {event.actor.displayName} ·{" "}
                        {eventTime.occurredAtLabel} ({eventTime.timeZoneBasis})
                        {event.reason ? ` · ${event.reason}` : ""}
                      </small>
                    </div>
                  );
                })}
                {entry.id === effectiveEntryId && (
                  <div>
                    {actions.verify && entry.status === "SUBMITTED" && (
                      <button
                        disabled={submitting}
                        onClick={() => void transition(entry, "verify")}
                      >
                        Verifikasi
                      </button>
                    )}
                    {actions.accept && entry.status === "VERIFIED" && (
                      <button
                        disabled={submitting}
                        onClick={() => void transition(entry, "accept")}
                      >
                        Terima
                      </button>
                    )}
                    {actions.correct && (
                      <button
                        disabled={submitting}
                        onClick={() =>
                          setCorrection({
                            entryId: entry.id,
                            commandId: crypto.randomUUID(),
                            installedQuantity: entry.installedQuantity,
                            workDate: correctionDate(entry.workDate),
                            captureMethod: correctionCaptureMethod(
                              entry.captureMethod,
                            ),
                            reason: "",
                          })
                        }
                      >
                        Buat koreksi
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
      </section>
      {correction && (
        <section aria-label="Koreksi Actual">
          <h3>Koreksi Actual</h3>
          <p>
            Actual lama tetap disimpan; koreksi menjadi fakta baru yang tertaut.
          </p>
          <label>
            Volume koreksi
            <input
              type="number"
              min="0"
              step="0.01"
              value={correction.installedQuantity}
              onChange={(e) =>
                setCorrection({
                  ...correction,
                  installedQuantity: e.target.value,
                })
              }
            />
          </label>
          <label>
            Tanggal pekerjaan
            <input
              type="date"
              value={correction.workDate}
              onChange={(e) =>
                setCorrection({ ...correction, workDate: e.target.value })
              }
            />
          </label>
          <label>
            Alasan koreksi
            <textarea
              value={correction.reason}
              onChange={(e) =>
                setCorrection({ ...correction, reason: e.target.value })
              }
              required
            />
          </label>
          <label>
            Metode pengukuran koreksi
            <select
              value={correction.captureMethod}
              onChange={(e) =>
                setCorrection({
                  ...correction,
                  captureMethod: e.target.value,
                })
              }
            >
              <option value="">Pilih metode</option>
              <option value="FIELD_OBSERVATION">Observasi lapangan</option>
              <option value="FIELD_MEASUREMENT">Pengukuran lapangan</option>
              <option value="DOCUMENT_REFERENCE">Referensi dokumen</option>
            </select>
          </label>
          <button
            disabled={
              submitting ||
              !correction.installedQuantity ||
              !correction.workDate ||
              !correction.captureMethod ||
              !correction.reason.trim()
            }
            onClick={() => void saveCorrection()}
          >
            Simpan koreksi
          </button>
          <button disabled={submitting} onClick={() => setCorrection(null)}>
            Batal
          </button>
        </section>
      )}
    </div>
  );
}
