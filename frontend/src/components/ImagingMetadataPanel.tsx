import React from 'react';

export interface ImagingMetadata {
  tciaCollectionId: string;
  modality?: string;
  bodyPart?: string;
  collectionName?: string;
  studyDate?: string;
  seriesCount?: number;
}

interface ImagingMetadataPanelProps {
  tciaCollectionId: string;
  patientName?: string;
}

/**
 * Derives basic imaging metadata from the TCIA collection ID.
 * In production this would call a TCIA API; here we derive from the ID pattern.
 */
export function deriveImagingMetadata(tciaCollectionId: string): ImagingMetadata {
  // TCIA collection IDs follow patterns like "TCGA-LUAD", "LIDC-IDRI", etc.
  const parts = tciaCollectionId.split('-');
  const prefix = parts[0]?.toUpperCase() || '';

  let modality = 'CT';
  let bodyPart = 'Unknown';
  let collectionName = tciaCollectionId;

  // Common TCIA collection mappings
  if (prefix === 'TCGA') {
    const subtype = parts[1]?.toUpperCase() || '';
    if (['LUAD', 'LUSC'].includes(subtype)) { bodyPart = 'Lung'; modality = 'CT'; collectionName = `TCGA ${subtype} Collection`; }
    else if (['BRCA'].includes(subtype)) { bodyPart = 'Breast'; modality = 'MRI'; collectionName = 'TCGA Breast Cancer'; }
    else if (['GBM', 'LGG'].includes(subtype)) { bodyPart = 'Brain'; modality = 'MRI'; collectionName = `TCGA ${subtype} Collection`; }
    else if (['PRAD'].includes(subtype)) { bodyPart = 'Prostate'; modality = 'MRI'; collectionName = 'TCGA Prostate Cancer'; }
    else if (['KIRC', 'KIRP'].includes(subtype)) { bodyPart = 'Kidney'; modality = 'CT'; collectionName = `TCGA ${subtype} Collection`; }
    else { collectionName = `TCGA ${subtype} Collection`; }
  } else if (prefix === 'LIDC') {
    bodyPart = 'Lung'; modality = 'CT'; collectionName = 'LIDC-IDRI Lung Nodule';
  }

  return { tciaCollectionId, modality, bodyPart, collectionName };
}

const ImagingMetadataPanel: React.FC<ImagingMetadataPanelProps> = ({ tciaCollectionId, patientName }) => {
  const meta = deriveImagingMetadata(tciaCollectionId);

  return (
    <div style={{
      padding: '16px',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      backgroundColor: '#f8f9fa',
      marginTop: '12px',
    }}>
      <h4 style={{ margin: '0 0 12px 0' }}>🩻 Medical Imaging</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
        <div><span style={{ color: '#666' }}>Collection:</span> {meta.collectionName}</div>
        <div><span style={{ color: '#666' }}>ID:</span> {meta.tciaCollectionId}</div>
        <div><span style={{ color: '#666' }}>Modality:</span> {meta.modality}</div>
        <div><span style={{ color: '#666' }}>Body Part:</span> {meta.bodyPart}</div>
        {patientName && <div><span style={{ color: '#666' }}>Patient:</span> {patientName}</div>}
      </div>
      <div style={{ marginTop: '10px', fontSize: '12px', color: '#888' }}>
        Source: <a
          href={`https://www.cancerimagingarchive.net/collection/${tciaCollectionId}/`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#007bff' }}
        >
          The Cancer Imaging Archive
        </a>
      </div>
    </div>
  );
};

export default ImagingMetadataPanel;
