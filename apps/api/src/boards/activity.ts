import { prisma } from '../db.js';

// Append-only activity log per board.

export type Verb =
  | 'card_created' | 'card_moved' | 'card_renamed' | 'card_archived' | 'card_deleted'
  | 'card_described' | 'card_due_set' | 'card_due_cleared'
  | 'card_cover_set' | 'card_cover_cleared'
  | 'card_ordered_by_set' | 'card_ordered_by_cleared'
  | 'member_assigned' | 'member_unassigned'
  | 'label_added' | 'label_removed'
  | 'comment_added'
  | 'checklist_added' | 'checklist_completed' | 'checklist_uncompleted'
  | 'list_created' | 'list_renamed' | 'list_archived'
  | 'board_created' | 'board_archived' | 'board_restored';

export async function logActivity(args: {
  boardId: string;
  actorId: string;
  verb: Verb;
  targetType: 'card' | 'list' | 'comment' | 'checklist' | 'board';
  targetId: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await prisma.activity.create({
      data: {
        boardId: args.boardId,
        actorId: args.actorId,
        verb: args.verb,
        targetType: args.targetType,
        targetId: args.targetId,
        meta: args.meta as never,
      },
    });
  } catch (err) {
    // Activity logging shouldn't break the main flow
    console.error('Failed to log activity', err);
  }
}
