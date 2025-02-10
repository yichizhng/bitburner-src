import * as React from "react";
import { formatFavor } from "../formatNumber";
import { Theme } from "@mui/material/styles";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()((theme: Theme) => ({
  favor: {
    color: theme.colors.rep,
  },
}));

export function Favor({ favor }: { favor: number }): React.ReactElement {
  const { classes } = useStyles();
  return <span className={classes.favor}>{formatFavor(favor)}</span>;
}
