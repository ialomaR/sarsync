import React from 'react';

// Provides peopleById and labelsById lookup maps to descendant components
// (Avatar, LabelChip, etc.) so they can render API data without bleeding
// the static fixtures.

const Ctx = React.createContext(null);

export function BoardDataProvider({ peopleById, labelsById, fieldsById, children }) {
  const value = React.useMemo(() => ({
    peopleById: peopleById || {},
    labelsById: labelsById || {},
    fieldsById: fieldsById || {},
  }), [peopleById, labelsById, fieldsById]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoardData() {
  return React.useContext(Ctx);
}
