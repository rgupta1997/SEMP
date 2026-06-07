import { PrismaClient } from '@prisma/client';

// Single PrismaClient, created here and shared with every persistence adapter
// via the composition root. The domain/application layers never import this.
export const prisma = new PrismaClient();

export type Prisma = typeof prisma;
