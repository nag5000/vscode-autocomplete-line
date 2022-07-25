export type RipGrepOptions = StringOrRegexSearchOptions & {
  fileType?: string | Array<string>;
  multiline?: boolean;
  passthru?: boolean;
  smartcase?: boolean;
  beforeContext?: number;
  afterContext?: number;
};

export type RipGrepJsonMatch = {
  type: string;
  data: {
    path: {
      text: string;
    };
    lines: {
      text: string;
    };
    // eslint-disable-next-line @typescript-eslint/naming-convention
    line_number: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    absolute_offset: number;
    submatches: Array<RipgrepJsonSubmatch>;
  };
};

type StringSearchOptions = {
  string: string;
};

type RegexSearchOptions = {
  regex: string;
};

type StringOrRegexSearchOptions = StringSearchOptions | RegexSearchOptions;

type RipgrepJsonSubmatch = {
  match: { text: string };
  start: number;
  end: number;
};
