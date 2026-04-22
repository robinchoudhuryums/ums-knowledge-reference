/**
 * Shared types + helpers for PpdQuestionnaire and its sub-components.
 */

export type Lang = 'en' | 'es';

export interface ApiQuestion {
  id: string;
  number: string;
  text: string;
  spanishText: string;
  type: 'yes-no' | 'text' | 'select' | 'number' | 'multi-select';
  group: string;
  required: boolean;
  subQuestionOf?: string;
  showWhen?: string;
  options?: string[];
}

export interface RecommendationProduct {
  hcpcsCode: string;
  description: string;
  justification: string;
  category: 'complex-rehab' | 'standard';
  imageUrl?: string;
  brochureUrl?: string;
  seatDimensions?: string;
  colors?: string;
  leadTime?: string;
  notes?: string;
  portable?: boolean;
}

export interface RecommendApiResponse {
  patientInfo: string;
  recommendations: RecommendationProduct[];
  submittedAt: string;
  agentName: string;
}

export function storageKey(patient: string): string {
  return `ppd_responses_${patient.replace(/\s+/g, '_').toLowerCase()}`;
}

// S2-7: revoke the object URL in both success and error paths so long
// agent sessions with many PMD recommendations don't accumulate blob
// URLs in memory until the tab is closed.
export function convertToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('Canvas not supported'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((b) => {
          cleanup();
          return b ? resolve(b) : reject(new Error('PNG conversion failed'));
        }, 'image/png');
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}
