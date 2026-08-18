// Captures the teacher's own browser tab (screen-record) rather than a
// clean server-side conference recording — chosen over Jitsi's own Jibri
// bot because Jibri needs its own heavy component on the Jitsi server.
// getDisplayMedia's "tab audio" only carries back what plays through the
// tab (the student's voice, arriving over the call) — the teacher's own
// microphone is a separate track that has to be captured and mixed in
// explicitly, or the recording would be one-sided.
const pickMimeType = () => {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
};

// Returns a fresh, self-contained recorder — every call gets its own
// closure over its tracks/recorder instead of shared module state, so
// start/stop can't get confused by an unrelated in-flight recording.
export const createCallRecorder = () => {
  let mediaRecorder = null;
  let recordedChunks = [];
  let displayStream = null;
  let micStream = null;
  let audioContext = null;
  let startedAt = null;

  const releaseTracks = () => {
    displayStream?.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    audioContext?.close();
    displayStream = null;
    micStream = null;
    audioContext = null;
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      throw new Error("This browser doesn't support screen recording.");
    }

    displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const destination = audioContext.createMediaStreamDestination();

    const tabAudioTracks = displayStream.getAudioTracks();
    if (tabAudioTracks.length > 0) {
      audioContext.createMediaStreamSource(new MediaStream(tabAudioTracks)).connect(destination);
    }
    audioContext.createMediaStreamSource(micStream).connect(destination);

    const combinedStream = new MediaStream([
      ...displayStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);

    recordedChunks = [];
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    startedAt = Date.now();
    // 1s timeslice — chunks land incrementally instead of only at stop(),
    // so a mid-recording crash doesn't lose the whole class.
    mediaRecorder.start(1000);
  };

  const stop = () =>
    new Promise((resolve, reject) => {
      if (!mediaRecorder) {
        reject(new Error("No recording in progress."));
        return;
      }
      mediaRecorder.onstop = () => {
        const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
        releaseTracks();
        mediaRecorder = null;
        recordedChunks = [];
        resolve({ blob, durationSeconds });
      };
      mediaRecorder.stop();
    });

  const isRecording = () => mediaRecorder !== null && mediaRecorder.state === "recording";

  return { start, stop, isRecording };
};
