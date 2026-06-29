export function getRequiredJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  
  if (secret === undefined || secret === null) {
    throw new Error('JWT_SECRET is required and must not be empty.');
  }
  
  if (secret.trim() === '') {
    throw new Error('JWT_SECRET is required and must not be empty.');
  }
  
  return secret;
}
