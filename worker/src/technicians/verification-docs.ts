import { SupabaseClient } from '@supabase/supabase-js';
import { MessageSender } from '../telegram/message-sender';

const MAX_ID_BYTES = 10 * 1024 * 1024;

/**
 * Stores a technician's ID photo in the private `verification-docs` bucket (spec §6.2, §11.13,
 * §18.4: verification documents use restricted storage). Only operators can read it, through
 * short-lived signed URLs on the dashboard. The Telegram file reference is not kept.
 */
export async function storeIdDocument(
  supabase: SupabaseClient,
  sender: MessageSender,
  profileId: string,
  photo: { fileId: string; uniqueId?: string; size?: number }
): Promise<'OK' | 'TOO_LARGE' | 'FAILED'> {
  if ((photo.size ?? 0) > MAX_ID_BYTES) return 'TOO_LARGE';
  const bytes = await sender.downloadFile(photo.fileId);
  if (!bytes) return 'FAILED';

  const path = `${profileId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('verification-docs').upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    console.error('ID document upload failed:', error.message);
    return 'FAILED';
  }

  const { error: rowError } = await supabase.from('attachments').insert({
    uploaded_by: profileId,
    telegram_file_unique_id: photo.uniqueId ?? null,
    storage_path: path,
    storage_reason: 'VERIFICATION',
    file_size_bytes: bytes.byteLength,
    mime_type: 'image/jpeg',
    attachment_type: 'VERIFICATION_DOCUMENT',
    storage_promoted_at: new Date().toISOString(),
  });
  if (rowError) console.error('ID document record failed:', rowError.message);
  return rowError ? 'FAILED' : 'OK';
}
