/**
 * VTT (WebVTT) Transcript Parser
 * Converts VTT transcript content into readable Markdown,
 * grouping consecutive segments by the same speaker.
 */

interface VttCue {
  startTime: string;
  endTime: string;
  speaker: string;
  text: string;
}

interface SpeakerBlock {
  speaker: string;
  startTime: string;
  lines: string[];
}

/**
 * Parse a timestamp string (HH:MM:SS.mmm) into a shorter display format (HH:MM:SS)
 */
function formatTimestamp(raw: string): string {
  const parts = raw.trim().split('.');
  return parts[0] ?? raw.trim();
}

/**
 * Parse a single VTT cue block into structured data.
 * Handles lines like "Speaker Name: text content" and plain text lines.
 */
function parseCue(timeLine: string, textLines: string[]): VttCue | null {
  const timeMatch = timeLine.match(
    /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/
  );
  if (!timeMatch) return null;

  const fullText = textLines.join(' ').trim();
  if (!fullText) return null;

  const speakerMatch = fullText.match(/^([^:]+):\s*(.+)$/);
  const speaker = speakerMatch ? speakerMatch[1].trim() : 'Unknown';
  const text = speakerMatch ? speakerMatch[2].trim() : fullText;

  return {
    startTime: formatTimestamp(timeMatch[1]),
    endTime: formatTimestamp(timeMatch[2]),
    speaker,
    text,
  };
}

/**
 * Parse raw VTT content into an array of cues
 */
function parseVttCues(vttContent: string): VttCue[] {
  const lines = vttContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const cues: VttCue[] = [];
  let i = 0;

  // Skip the WEBVTT header and any metadata
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.includes('-->')) {
      const timeLine = line;
      const textLines: string[] = [];
      i++;

      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }

      const cue = parseCue(timeLine, textLines);
      if (cue) cues.push(cue);
    } else {
      i++;
    }
  }

  return cues;
}

/**
 * Group consecutive cues by the same speaker into blocks
 */
function groupBySpeaker(cues: VttCue[]): SpeakerBlock[] {
  const blocks: SpeakerBlock[] = [];

  for (const cue of cues) {
    const lastBlock = blocks[blocks.length - 1];

    if (lastBlock && lastBlock.speaker === cue.speaker) {
      lastBlock.lines.push(cue.text);
    } else {
      blocks.push({
        speaker: cue.speaker,
        startTime: cue.startTime,
        lines: [cue.text],
      });
    }
  }

  return blocks;
}

/**
 * Convert VTT transcript content to formatted Markdown.
 *
 * @param vttContent - Raw VTT file content
 * @param meetingTopic - Meeting title for the document heading
 * @param meetingDate - Meeting date string for metadata
 * @returns Formatted Markdown string
 */
export function vttToMarkdown(
  vttContent: string,
  meetingTopic?: string,
  meetingDate?: string,
): string {
  const cues = parseVttCues(vttContent);
  if (cues.length === 0) {
    return meetingTopic
      ? `# ${meetingTopic}\n\n*No transcript content available.*\n`
      : '*No transcript content available.*\n';
  }

  const blocks = groupBySpeaker(cues);
  const parts: string[] = [];

  if (meetingTopic) {
    parts.push(`# ${meetingTopic}`);
  }

  if (meetingDate) {
    parts.push(`**Date:** ${meetingDate}`);
  }

  if (meetingTopic || meetingDate) {
    parts.push('---');
  }

  for (const block of blocks) {
    const combinedText = block.lines.join(' ');
    parts.push(`**${block.speaker}** *(${block.startTime})*\n${combinedText}`);
  }

  return parts.join('\n\n') + '\n';
}

/**
 * Extract unique speaker names from VTT content
 */
export function extractSpeakers(vttContent: string): string[] {
  const cues = parseVttCues(vttContent);
  const speakers = new Set<string>();
  for (const cue of cues) {
    speakers.add(cue.speaker);
  }
  return Array.from(speakers);
}
