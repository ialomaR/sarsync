import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AppShell } from '../kanban/AppShell.jsx';
import { BoardSubBar, KanbanBoard } from '../kanban/KanbanBoard.jsx';
import { CardModal } from './CardModal.jsx';
import { useSettings } from '../state/SettingsContext.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { buildTheme } from '../ui/theme.js';
import { useBoardApi } from '../state/useBoardApi.js';
import { DragProvider } from '../state/board-state.jsx';
import { BoardDataProvider } from '../state/BoardDataContext.jsx';
import { activeMembership, canEditBoard, canManageBoard, canDeleteBoard, canEditCard } from '../state/permissions.js';
import { BoardError, LoadingScreen } from '../ui/States.jsx';

export function BoardPage() {
  const { id } = useParams();
  const s = useSettings();
  const auth = useAuth();
  const theme = buildTheme(s.themeName, s.accent);
  const [params, setParams] = useSearchParams();
  const cardId = params.get('card');
  const m = activeMembership(auth);

  const board = useBoardApi(id);
  const canEdit = canEditBoard(m, board.board);
  const canManage = canManageBoard(m, board.board);
  const canDelete = canDeleteBoard(m);
  const found = cardId && !cardId.startsWith('tmp-') ? board.findCard(cardId) : null;

  const [filterText, setFilterText] = React.useState('');
  const visibleLists = React.useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return board.lists;
    return board.lists.map((l) => ({
      ...l,
      cards: l.cards.filter((c) => (c.title || '').toLowerCase().includes(q)),
    }));
  }, [board.lists, filterText]);

  const openCard = (cid) => {
    if (cid.startsWith('tmp-')) return;
    const next = new URLSearchParams(params);
    next.set('card', cid);
    setParams(next, { replace: false });
  };
  const closeCard = () => {
    const next = new URLSearchParams(params);
    next.delete('card');
    setParams(next, { replace: false });
  };

  return (
    <AppShell board={board.board ? { title: board.board.title } : null}>
      <BoardDataProvider peopleById={board.peopleById} labelsById={board.labelsById}>
        {board.status === 'loading' && (
          <LoadingScreen theme={theme} rtl={s.rtl} />
        )}
        {board.status === 'error' && (
          <BoardError theme={theme} rtl={s.rtl} error={board.error} onRetry={board.refetch} />
        )}
        {board.status === 'ready' && board.board && (
          <>
            <BoardSubBar theme={theme} board={board.board} showAvatars={s.showAvatars} rtl={s.rtl}
              canEdit={canEdit}
              canManage={canManage}
              canDelete={canDelete}
              onUpdateBoard={canManage ? board.updateBoard : null}
              onToggleStar={board.toggleStar}
              onArchiveBoard={canManage ? board.archiveBoard : null}
              onDeleteBoard={canDelete ? board.deleteBoard : null}
              onUploadCover={canManage ? board.uploadCover : null}
              onRemoveCover={canManage ? board.removeCover : null}
              lists={board.lists}
              onAddCard={canEdit ? board.addCard : null}
              filterText={filterText}
              onFilterChange={setFilterText} />
            <DragProvider onMove={canEdit ? board.moveCard : () => {}}>
              <KanbanBoard theme={theme} lists={visibleLists} density={s.density}
                showAvatars={s.showAvatars} rtl={s.rtl}
                canEdit={canEdit}
                onCardClick={openCard}
                onAddCard={canEdit ? board.addCard : null}
                onAddList={canEdit ? board.addList : null}
                onRenameList={canEdit ? board.renameList : null}
                onDeleteList={canEdit ? board.deleteList : null} />
            </DragProvider>
            {found && (
              <CardModal theme={theme} rtl={s.rtl}
                cardId={found.card.id} listTitle={found.list.title}
                workspaceId={board.board.workspaceId}
                canEdit={canEdit}
                membership={m}
                boardDepartmentId={board.board.departmentId}
                onClose={closeCard}
                onCardChanged={(patch) => board.patchLocalCard(found.card.id, patch)}
                onRefetchBoard={board.refetch} />
            )}
          </>
        )}
      </BoardDataProvider>
    </AppShell>
  );
}

