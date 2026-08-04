import "server-only";

import { getGoogleDriveAccessToken } from "@/lib/drive/serviceAccountAuth";

const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";

class GoogleDriveFolderConfigurationError extends Error {
  constructor() {
    super(
      "Google Drive 폴더 설정이 없습니다. GOOGLE_DRIVE_FOLDER_ID를 설정해 주세요.",
    );
    this.name = "GoogleDriveFolderConfigurationError";
  }
}

function getArchiveFolderId() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!folderId) throw new GoogleDriveFolderConfigurationError();
  return folderId;
}

export interface DriveUploadResult {
  fileId: string;
  name: string;
  mimeType: string;
}

/**
 * 바이트 스트림을 Google Drive 폴더에 단일 파일로 업로드합니다.
 * uploadType=multipart로 파일 이름과 상위 폴더를 요청 본문 메타데이터에 실어
 * 쿼리 문자열 길이 제한과 별개로 안전하게 전달합니다.
 */
export async function uploadToGoogleDrive(input: {
  name: string;
  contentType: string;
  body: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<DriveUploadResult> {
  const accessToken = await getGoogleDriveAccessToken(input.fetchImpl);
  const folderId = getArchiveFolderId();

  const boundary = `ninety-nine-drive-${crypto.randomUUID()}`;
  const metadata = `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify({ name: input.name, parents: [folderId] }) + "\r\n";
  const filePreamble = `--${boundary}\r\nContent-Type: ${input.contentType}\r\n\r\n`;
  const epilogue = `\r\n--${boundary}--\r\n`;

  const encoder = new TextEncoder();
  const body = new Uint8Array(
    metadata.length + filePreamble.length + input.body.byteLength + epilogue.length,
  );
  body.set(encoder.encode(metadata), 0);
  body.set(encoder.encode(filePreamble), metadata.length);
  body.set(input.body, metadata.length + filePreamble.length);
  body.set(encoder.encode(epilogue), metadata.length + filePreamble.length + input.body.byteLength);

  const response = await (input.fetchImpl ?? fetch)(DRIVE_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Google Drive 업로드 실패: ${response.status}`);
  }
  const result = (await response.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
  };
  return {
    fileId: result.id ?? "",
    name: result.name ?? input.name,
    mimeType: result.mimeType ?? input.contentType,
  };
}
