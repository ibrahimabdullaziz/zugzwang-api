type CursorData = {
  createdAt: Date;
  id: string;
};

export function encodeCursor(data: CursorData): string {
  const cursorData = {
    createdAt: data.createdAt.toISOString(),
    id: data.id,
  };

  return Buffer.from(JSON.stringify(cursorData)).toString('base64');
}

export function decodeCursor(cursor: string): CursorData {
  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const data = JSON.parse(decoded);

  return {
    createdAt: new Date(data.createdAt),
    id: data.id,
  };
}
