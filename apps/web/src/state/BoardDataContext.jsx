import React from 'react';

// Provides peopleById and labelsById lookup maps to descendant components
// (Avatar, LabelChip, etc.) so they can render API data without bleeding
// the static fixtures.

const Ctx = React.createContext(null);

export function BoardDataProvider({ peopleById, labelsById, children }) {
  const value = React.useMemo(() => ({
    peopleById: peopleById || {},
    labelsById: labelsById || {},
  }), [peopleById, labelsById]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoardData() {
  return React.useContext(Ctx);
}
