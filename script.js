/**
 * CSV Graph Assistant - script.js
 * Fully browser-based data intelligence platform
 * Uses: File API, FileReader API, Canvas API, localStorage, DOM manipulation
 */

'use strict';

/* ============================================================
   APPLICATION STATE
   ============================================================ */
const AppState = {
  dataset: null,       // { filename, headers, rows, analysis }
  graph: null,         // { nodes, edges }
  currentSection: 'overview',
  queryHistory: [],
  queryCount: 0,
  // Explorer state
  explorer: {
    filteredRows: [],
    sortCol: null,
    sortDir: 'asc',
    currentPage: 1,
    pageSize: 25,
  },
  // Graph state
  graphView: {
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStart: null,
    nodes: [],
    edges: [],
    hoveredNode: null,
    selectedNode: null,
    animFrame: null,
  },
};

/* ============================================================
   SAMPLE DATASET
   ============================================================ */
const SAMPLE_CSV = `Name,Department,Role,Location,Salary,Experience,Status,Email
Ravi Kumar,IT,Developer,Chennai,45000,3,Active,ravi@example.com
Priya Sharma,IT,Tester,Chennai,40000,2,Active,priya@example.com
Arun Krishnan,HR,Manager,Coimbatore,55000,8,Active,arun@example.com
Karthik Rajan,Finance,Analyst,Bangalore,48000,4,Active,karthik@example.com
Meena Devi,HR,Executive,Chennai,35000,1,Active,meena@example.com
Surya Prakash,IT,Developer,Bangalore,50000,5,Active,surya@example.com
Divya Nair,Finance,Accountant,Coimbatore,42000,3,Active,divya@example.com
Ramesh Babu,IT,Lead,Chennai,65000,10,Active,ramesh@example.com
Anitha Joseph,HR,Recruiter,Bangalore,38000,2,Active,anitha@example.com
Vijay Kumar,Finance,Manager,Chennai,60000,7,Active,vijay@example.com
Lakshmi Priya,IT,Designer,Coimbatore,43000,3,Active,lakshmi@example.com
Suresh Raj,Operations,Executive,Bangalore,36000,1,Inactive,suresh@example.com
Kavitha Sundaram,HR,Manager,Chennai,58000,9,Active,kavitha@example.com
Mani Prabhu,IT,DevOps,Coimbatore,52000,6,Active,mani@example.com
Sathya Kumar,Finance,Analyst,Bangalore,45000,3,Active,sathya@example.com
Deepa Krishnan,Operations,Manager,Chennai,55000,8,Active,deepa@example.com
Arjun Patel,IT,Developer,Bangalore,47000,4,Active,arjun@example.com
Nalini Devi,HR,Executive,Coimbatore,34000,1,Active,nalini@example.com
Prakash Raj,Finance,Lead,Chennai,62000,9,Active,prakash@example.com
Saravana Kumar,IT,Tester,Bangalore,41000,2,Active,saravana@example.com`;

/* ============================================================
   CSV PARSER
   ============================================================ */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) throw new Error('CSV must have at least one header row and one data row.');

  // Parse a single CSV line respecting quoted fields
  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]);
  if (headers.length === 0 || headers.every(h => h === ''))
    throw new Error('No headers detected. First row must contain column names.');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseLine(line);
    if (values.length === 0) continue;
    // Skip lines that are all empty
    if (values.every(v => v === '')) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(row);
  }

  if (rows.length === 0) throw new Error('No data rows found in CSV.');
  return { headers, rows };
}

/* ============================================================
   DATASET ANALYSIS
   ============================================================ */
function analyzeDataset(headers, rows) {
  const analysis = {
    rowCount: rows.length,
    colCount: headers.length,
    columns: {},
    uniqueTotal: 0,
    emptyTotal: 0,
  };

  headers.forEach(h => {
    const values = rows.map(r => r[h]);
    const nonEmpty = values.filter(v => v !== '' && v !== null && v !== undefined);
    const emptyCount = values.length - nonEmpty.length;
    const unique = [...new Set(nonEmpty)];
    const uniqueCount = unique.length;
    const numCount = nonEmpty.filter(v => !isNaN(v) && v !== '').length;
    const numRatio = nonEmpty.length > 0 ? numCount / nonEmpty.length : 0;

    let type = 'TEXT';
    if (numRatio > 0.9) {
      type = 'NUMBER';
    } else if (uniqueCount <= Math.max(10, rows.length * 0.15) && nonEmpty.length > 0) {
      type = 'CATEGORY';
    } else if (
      (h.toLowerCase().includes('id') || h.toLowerCase().includes('code') || h.toLowerCase().includes('key')) &&
      uniqueCount === nonEmpty.length
    ) {
      type = 'ID';
    }

    const numVals = numRatio > 0.9 ? nonEmpty.map(Number).filter(n => !isNaN(n)) : [];
    analysis.columns[h] = {
      type,
      unique: uniqueCount,
      empty: emptyCount,
      values: unique,
      min: numVals.length ? Math.min(...numVals) : null,
      max: numVals.length ? Math.max(...numVals) : null,
      avg: numVals.length ? (numVals.reduce((a, b) => a + b, 0) / numVals.length) : null,
    };
    analysis.uniqueTotal += uniqueCount;
    analysis.emptyTotal += emptyCount;
  });

  return analysis;
}

/* ============================================================
   GRAPH GENERATION
   ============================================================ */
function generateGraph(headers, rows, analysis) {
  const nodes = [];
  const edges = [];
  const nodeMap = {};

  // Identify category columns (for relationship nodes)
  const categoryColumns = headers.filter(h => analysis.columns[h].type === 'CATEGORY');
  const idColumn = headers.find(h => analysis.columns[h].type === 'ID') || headers[0];

  // Create category value nodes
  categoryColumns.forEach(col => {
    const uniqueVals = analysis.columns[col].values;
    uniqueVals.forEach(val => {
      if (val === '') return;
      const key = `cat_${col}_${val}`;
      if (!nodeMap[key]) {
        const node = { id: key, label: String(val), type: 'category', category: col, properties: { Type: col, Value: val } };
        nodes.push(node);
        nodeMap[key] = node;
      }
    });
  });

  // Limit record nodes for performance (max 80)
  const maxRecords = Math.min(rows.length, 80);
  for (let i = 0; i < maxRecords; i++) {
    const row = rows[i];
    const label = String(row[idColumn] || `Row ${i + 1}`);
    const key = `rec_${i}`;
    const props = {};
    headers.forEach(h => { props[h] = row[h]; });
    const node = { id: key, label, type: 'record', rowIndex: i, properties: props };
    nodes.push(node);
    nodeMap[key] = node;

    // Create edges to category values
    categoryColumns.forEach(col => {
      const val = row[col];
      if (!val || val === '') return;
      const catKey = `cat_${col}_${val}`;
      if (nodeMap[catKey]) {
        edges.push({ from: key, to: catKey, label: col, id: `e_${key}_${catKey}` });
      }
    });
  }

  return { nodes, edges };
}

/* ============================================================
   GRAPH LAYOUT (Force-directed simulation)
   ============================================================ */
function layoutGraph(nodes, edges, width, height) {
  const W = width || 800;
  const H = height || 600;
  const cx = W / 2;
  const cy = H / 2;

  // Separate record and category nodes
  const records = nodes.filter(n => n.type === 'record');
  const categories = nodes.filter(n => n.type === 'category');

  // Place categories in outer ring
  categories.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / categories.length;
    const r = Math.min(W, H) * 0.38;
    n.x = cx + r * Math.cos(angle);
    n.y = cy + r * Math.sin(angle);
    n.vx = 0; n.vy = 0;
  });

  // Place records in inner cluster
  records.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / records.length;
    const r = Math.min(W, H) * 0.2;
    n.x = cx + r * Math.cos(angle) + (Math.random() - 0.5) * 30;
    n.y = cy + r * Math.sin(angle) + (Math.random() - 0.5) * 30;
    n.vx = 0; n.vy = 0;
  });

  // Simple force simulation
  const sim = { nodes, edges };
  for (let iter = 0; iter < 60; iter++) {
    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 1800 / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    // Attraction along edges
    edges.forEach(e => {
      const a = nodes.find(n => n.id === e.from);
      const b = nodes.find(n => n.id === e.to);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = a.type !== b.type ? 140 : 80;
      const force = (dist - targetDist) * 0.04;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });
    // Apply velocity with damping and bounds
    nodes.forEach(n => {
      n.vx *= 0.85; n.vy *= 0.85;
      n.x = Math.max(40, Math.min(W - 40, n.x + n.vx));
      n.y = Math.max(40, Math.min(H - 40, n.y + n.vy));
    });
  }
  return sim;
}

/* ============================================================
   GRAPH RENDERING (Canvas)
   ============================================================ */
function renderGraph() {
  const canvas = document.getElementById('graphCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const gv = AppState.graphView;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Dark background
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, W, H);

  if (!gv.nodes || gv.nodes.length === 0) return;

  ctx.save();
  ctx.translate(gv.panX, gv.panY);
  ctx.scale(gv.zoom, gv.zoom);

  // Draw edges
  gv.edges.forEach(e => {
    const a = gv.nodes.find(n => n.id === e.from);
    const b = gv.nodes.find(n => n.id === e.to);
    if (!a || !b) return;

    const isHighlighted = gv.selectedNode &&
      (gv.selectedNode.id === a.id || gv.selectedNode.id === b.id);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);

    if (isHighlighted) {
      ctx.strokeStyle = 'rgba(0,212,255,0.7)';
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = 'rgba(124,58,237,0.25)';
      ctx.lineWidth = 1;
    }
    ctx.stroke();
  });

  // Draw nodes
  gv.nodes.forEach(n => {
    const isHovered = gv.hoveredNode && gv.hoveredNode.id === n.id;
    const isSelected = gv.selectedNode && gv.selectedNode.id === n.id;
    const isConnected = gv.selectedNode && isConnectedToSelected(n);

    let r, color, glow;
    if (n.type === 'record') {
      r = isHovered || isSelected ? 10 : 7;
      color = isSelected ? '#fff' : isConnected ? '#00d4ff' : 'rgba(0,212,255,0.85)';
      glow = isSelected || isHovered;
    } else {
      r = isHovered || isSelected ? 14 : 10;
      color = isSelected ? '#fff' : isConnected ? '#9d5af5' : 'rgba(124,58,237,0.85)';
      glow = isSelected || isHovered;
    }

    if (glow) {
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
      grad.addColorStop(0, n.type === 'record' ? 'rgba(0,212,255,0.3)' : 'rgba(124,58,237,0.3)');
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (isSelected || isHovered) {
      ctx.strokeStyle = n.type === 'record' ? '#00d4ff' : '#9d5af5';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw label
    ctx.font = `${r > 8 ? '10' : '9'}px Inter, sans-serif`;
    ctx.fillStyle = isSelected || isHovered ? '#fff' : 'rgba(240,244,255,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(truncateLabel(n.label, 12), n.x, n.y + r + 12);
  });

  ctx.restore();
}

function isConnectedToSelected(node) {
  const gv = AppState.graphView;
  if (!gv.selectedNode) return false;
  return gv.edges.some(e =>
    (e.from === gv.selectedNode.id && e.to === node.id) ||
    (e.to === gv.selectedNode.id && e.from === node.id)
  );
}

function truncateLabel(str, max) {
  return str && str.length > max ? str.slice(0, max) + '…' : (str || '');
}

/* ============================================================
   NATURAL LANGUAGE QUERY ENGINE
   ============================================================ */
function processQuestion(question) {
  if (!AppState.dataset) {
    return {
      answer: 'No dataset is currently loaded. Please upload a CSV file first.',
      cypher: '// No dataset loaded',
      raw: null,
      grounded: false,
      type: 'error',
    };
  }

  const { headers, rows, analysis } = AppState.dataset;
  const q = question.toLowerCase().trim();
  const result = { question, grounded: true, raw: null };

  // ---- Helper: find matching column by keyword
  function findColumn(keyword) {
    const kw = keyword.toLowerCase();
    return headers.find(h => h.toLowerCase().includes(kw));
  }

  // ---- Helper: find value in a column
  function findValue(col, val) {
    const v = val.toLowerCase();
    return rows.filter(r => String(r[col] || '').toLowerCase() === v);
  }

  // ---- Helper: fuzzy find any column matching a word in query
  function matchColumnInQuery() {
    for (const h of headers) {
      if (q.includes(h.toLowerCase())) return h;
    }
    return null;
  }

  // ---- Helper: fuzzy find value in query across all category columns
  function matchValueInQuery() {
    const catCols = headers.filter(h => analysis.columns[h].type === 'CATEGORY');
    for (const col of catCols) {
      for (const val of analysis.columns[col].values) {
        if (val && q.includes(String(val).toLowerCase())) {
          return { col, val };
        }
      }
    }
    return null;
  }

  // ---- Helper: find record by name-ish column
  function findRecord(keyword) {
    const kw = keyword.toLowerCase();
    // Try first column or any text column
    const textCols = headers.filter(h => analysis.columns[h].type === 'TEXT' || analysis.columns[h].type === 'ID');
    for (const col of textCols) {
      const found = rows.filter(r => String(r[col] || '').toLowerCase().includes(kw));
      if (found.length > 0) return { col, rows: found };
    }
    return null;
  }

  // ---- COLUMN QUERY
  if (q.includes('column') || q.includes('field') || q.includes('header') || q.includes('attribute')) {
    result.answer = `The dataset has ${headers.length} columns: ${headers.map(h => `<strong>${h}</strong>`).join(', ')}.`;
    result.cypher = `MATCH (r:Row)\nRETURN keys(r) AS columns`;
    result.raw = { columns: headers };
    result.type = 'columns';
    return result;
  }

  // ---- SHOW ALL / LIST ALL
  if ((q.includes('show all') || q.includes('list all') || q.includes('display all') || q === 'all' || q.includes('show every') || q.includes('all records') || q.includes('all data'))) {
    result.answer = `Showing all ${rows.length} records from the dataset.`;
    result.cypher = `MATCH (r:Row)\nRETURN r`;
    result.raw = rows.slice(0, 50);
    result.type = 'table';
    return result;
  }

  // ---- COUNT ALL
  if ((q.includes('how many') || q.includes('count') || q.includes('total number')) && !matchValueInQuery() && !matchColumnInQuery()) {
    result.answer = `There are <strong>${rows.length.toLocaleString()}</strong> total records in the dataset.`;
    result.cypher = `MATCH (r:Row)\nRETURN count(r) AS total`;
    result.raw = { count: rows.length };
    result.type = 'count';
    return result;
  }

  // ---- UNIQUE VALUES in a column
  if (q.includes('unique') || q.includes('distinct') || q.includes('different') || q.startsWith('what ')) {
    const col = matchColumnInQuery();
    if (col) {
      const vals = analysis.columns[col].values;
      result.answer = `There are <strong>${vals.length}</strong> unique values in <strong>${col}</strong>: ${vals.slice(0, 30).join(', ')}${vals.length > 30 ? '...' : ''}.`;
      result.cypher = `MATCH (r:Row)\nRETURN DISTINCT r.${col}`;
      result.raw = { column: col, unique_values: vals, count: vals.length };
      result.type = 'list';
      return result;
    }
  }

  // ---- GROUP COUNT (how many X in each Y)
  if ((q.includes('each') || q.includes('per') || q.includes('by ') || q.includes('group')) && q.includes('how many')) {
    const col = matchColumnInQuery();
    if (col && analysis.columns[col].type === 'CATEGORY') {
      const groups = {};
      rows.forEach(r => {
        const v = r[col] || '(empty)';
        groups[v] = (groups[v] || 0) + 1;
      });
      const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
      const answerList = entries.map(([k, v]) => `${k}: ${v}`).join(', ');
      result.answer = `Record count by <strong>${col}</strong>: ${answerList}.`;
      result.cypher = `MATCH (r:Row)\nRETURN r.${col} AS ${col}, count(r) AS count\nORDER BY count DESC`;
      result.raw = Object.fromEntries(entries);
      result.type = 'group';
      return result;
    }
  }

  // ---- FILTER + COUNT: how many X in/with value?
  const matchedVal = matchValueInQuery();
  if ((q.includes('how many') || q.includes('count')) && matchedVal) {
    const { col, val } = matchedVal;
    const matched = findValue(col, val);
    result.answer = `There are <strong>${matched.length}</strong> records where <strong>${col}</strong> is <strong>${val}</strong>.`;
    result.cypher = `MATCH (r:Row)\nWHERE r.${col} = '${val}'\nRETURN count(r)`;
    result.raw = { count: matched.length, filter: { column: col, value: val } };
    result.type = 'count';
    return result;
  }

  // ---- FILTER LIST: show/list X in/from value
  if ((q.includes('show') || q.includes('list') || q.includes('find') || q.includes('get') || q.includes('display')) && matchedVal) {
    const { col, val } = matchedVal;
    const matched = findValue(col, val);
    if (matched.length > 0) {
      result.answer = `Found <strong>${matched.length}</strong> records where <strong>${col}</strong> is <strong>${val}</strong>.`;
      result.cypher = `MATCH (r:Row)\nWHERE r.${col} = '${val}'\nRETURN r`;
      result.raw = matched.slice(0, 25);
      result.type = 'table';
      return result;
    }
  }

  // ---- FIND record by name
  const words = q.replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2);
  for (const word of words) {
    if (['show','list','find','what','where','when','which','how','many','are','the','all','data','records','columns','fields','values','that','with','from','does','have','has'].includes(word)) continue;
    const found = findRecord(word);
    if (found && found.rows.length > 0) {
      result.answer = `Found <strong>${found.rows.length}</strong> record(s) matching "<strong>${word}</strong>" in <strong>${found.col}</strong>.`;
      result.cypher = `MATCH (r:Row)\nWHERE r.${found.col} CONTAINS '${word}'\nRETURN r`;
      result.raw = found.rows;
      result.type = 'table';
      return result;
    }
  }

  // ---- SUMMARY / ANALYSIS question
  if (q.includes('summary') || q.includes('overview') || q.includes('describe') || q.includes('about')) {
    const numCols = headers.filter(h => analysis.columns[h].type === 'NUMBER');
    const catCols = headers.filter(h => analysis.columns[h].type === 'CATEGORY');
    const textCols = headers.filter(h => analysis.columns[h].type === 'TEXT' || analysis.columns[h].type === 'ID');
    result.answer = `Dataset summary: <strong>${rows.length}</strong> records, <strong>${headers.length}</strong> columns. Numeric columns: ${numCols.join(', ') || 'none'}. Category columns: ${catCols.join(', ') || 'none'}. Text/ID columns: ${textCols.join(', ') || 'none'}.`;
    result.cypher = `// Dataset summary\nMATCH (r:Row) RETURN count(r) AS total`;
    result.raw = { total_records: rows.length, total_columns: headers.length, numeric_columns: numCols, category_columns: catCols, text_columns: textCols };
    result.type = 'summary';
    return result;
  }

  // ---- NUMERIC STATS (min, max, average, sum)
  const numCol = headers.find(h => analysis.columns[h].type === 'NUMBER' && q.includes(h.toLowerCase()));
  if (numCol) {
    const col = analysis.columns[numCol];
    if (q.includes('average') || q.includes('avg') || q.includes('mean')) {
      result.answer = `The average <strong>${numCol}</strong> is <strong>${col.avg ? col.avg.toFixed(2) : 'N/A'}</strong>.`;
      result.cypher = `MATCH (r:Row)\nRETURN avg(toFloat(r.${numCol})) AS average`;
      result.raw = { average: col.avg, column: numCol };
      result.type = 'stat';
      return result;
    }
    if (q.includes('max') || q.includes('highest') || q.includes('maximum')) {
      result.answer = `The maximum <strong>${numCol}</strong> is <strong>${col.max}</strong>.`;
      result.cypher = `MATCH (r:Row)\nRETURN max(toFloat(r.${numCol})) AS max`;
      result.raw = { max: col.max, column: numCol };
      result.type = 'stat';
      return result;
    }
    if (q.includes('min') || q.includes('lowest') || q.includes('minimum')) {
      result.answer = `The minimum <strong>${numCol}</strong> is <strong>${col.min}</strong>.`;
      result.cypher = `MATCH (r:Row)\nRETURN min(toFloat(r.${numCol})) AS min`;
      result.raw = { min: col.min, column: numCol };
      result.type = 'stat';
      return result;
    }
    if (q.includes('sum') || q.includes('total')) {
      const vals = rows.map(r => parseFloat(r[numCol])).filter(v => !isNaN(v));
      const sum = vals.reduce((a, b) => a + b, 0);
      result.answer = `The total sum of <strong>${numCol}</strong> is <strong>${sum.toLocaleString()}</strong>.`;
      result.cypher = `MATCH (r:Row)\nRETURN sum(toFloat(r.${numCol})) AS total`;
      result.raw = { sum, column: numCol };
      result.type = 'stat';
      return result;
    }
  }

  // ---- NOT GROUNDED: ask about a column not present
  const askedCols = ['age', 'phone', 'address', 'gender', 'city', 'country', 'date', 'time', 'score', 'grade', 'price', 'id', 'email', 'url', 'image', 'photo'];
  for (const ac of askedCols) {
    if (q.includes(ac) && !headers.some(h => h.toLowerCase().includes(ac))) {
      result.answer = `I cannot answer this from the uploaded dataset because a <strong>${ac}</strong> field is not available in the data. Available columns are: ${headers.join(', ')}.`;
      result.cypher = `// Column '${ac}' not found in dataset`;
      result.raw = null;
      result.grounded = false;
      result.type = 'not_grounded';
      return result;
    }
  }

  // ---- FALLBACK
  result.answer = `I'm not sure how to interpret that question. Try asking: "How many records are there?", "Show all data", "What columns are available?", or "How many [value] are in [column]?". Available columns: <strong>${headers.join(', ')}</strong>.`;
  result.cypher = `// Could not parse query`;
  result.raw = null;
  result.grounded = false;
  result.type = 'fallback';
  return result;
}

/* ============================================================
   GROUNDING CHECK
   ============================================================ */
function checkGrounding(result) {
  return result.grounded === true;
}

/* ============================================================
   LOCAL STORAGE
   ============================================================ */
function saveToLocalStorage() {
  try {
    if (AppState.dataset) {
      localStorage.setItem('csvga_dataset', JSON.stringify({
        filename: AppState.dataset.filename,
        headers: AppState.dataset.headers,
        rows: AppState.dataset.rows,
        analysis: AppState.dataset.analysis,
      }));
    }
    localStorage.setItem('csvga_history', JSON.stringify(AppState.queryHistory));
    localStorage.setItem('csvga_queryCount', String(AppState.queryCount));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
}

function loadFromLocalStorage() {
  try {
    const ds = localStorage.getItem('csvga_dataset');
    if (ds) {
      const parsed = JSON.parse(ds);
      AppState.dataset = parsed;
      return true;
    }
  } catch (e) {
    console.warn('localStorage load failed:', e);
  }
  return false;
}

function loadHistoryFromStorage() {
  try {
    const h = localStorage.getItem('csvga_history');
    if (h) AppState.queryHistory = JSON.parse(h);
    const qc = localStorage.getItem('csvga_queryCount');
    if (qc) AppState.queryCount = parseInt(qc) || 0;
  } catch (e) {}
}

function clearLocalStorage() {
  try {
    localStorage.removeItem('csvga_dataset');
    localStorage.removeItem('csvga_history');
    localStorage.removeItem('csvga_queryCount');
  } catch (e) {}
}

/* ============================================================
   TOAST NOTIFICATION
   ============================================================ */
let toastTimer = null;
function showToast(msg, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, duration);
}

/* ============================================================
   UI UPDATE HELPERS
   ============================================================ */
function updateStats() {
  const ds = AppState.dataset;
  const g = AppState.graph;

  const records = ds ? ds.rows.length : 0;
  const cols = ds ? ds.headers.length : 0;
  const unique = ds ? ds.analysis.uniqueTotal : 0;
  const nodes = g ? g.nodes.length : 0;

  document.getElementById('statRecordsVal').textContent = records.toLocaleString();
  document.getElementById('statColumnsVal').textContent = cols;
  document.getElementById('statUniqueVal').textContent = unique.toLocaleString();
  document.getElementById('statNodesVal').textContent = nodes;

  // Status page
  document.getElementById('statusFileName').textContent = ds ? ds.filename : 'None';
  document.getElementById('statusRows').textContent = records.toLocaleString();
  document.getElementById('statusCols').textContent = cols;
  document.getElementById('statusNodes').textContent = nodes;
  document.getElementById('statusEdges').textContent = g ? g.edges.length : 0;
  document.getElementById('statusQueries').textContent = AppState.queryCount;

  // Topbar indicator
  const dot = document.getElementById('indicatorDot');
  const label = document.getElementById('indicatorLabel');
  const clearBtn = document.getElementById('clearDatasetBtn');
  if (ds) {
    dot.className = 'indicator-dot active';
    label.textContent = ds.filename;
    clearBtn.style.display = '';
  } else {
    dot.className = 'indicator-dot inactive';
    label.textContent = 'No Dataset';
    clearBtn.style.display = 'none';
  }
}

function updateOverviewNoDataset() {
  const notice = document.getElementById('overviewNoDataset');
  const schemaBlock = document.getElementById('schemaBlock');
  if (AppState.dataset) {
    notice.style.display = 'none';
    renderSchema();
  } else {
    notice.style.display = 'block';
    schemaBlock.style.display = 'none';
  }
}

function renderSchema() {
  const schemaBlock = document.getElementById('schemaBlock');
  const schemaGrid = document.getElementById('schemaGrid');
  if (!AppState.dataset) return;
  schemaBlock.style.display = '';
  const { headers, analysis } = AppState.dataset;
  schemaGrid.innerHTML = '';
  headers.forEach(h => {
    const col = analysis.columns[h];
    const tag = document.createElement('div');
    tag.className = `schema-tag type-${col.type.toLowerCase()}`;
    tag.innerHTML = `<span class="schema-tag-name">${h}</span><span class="schema-tag-type">${col.type}</span>`;
    schemaGrid.appendChild(tag);
  });
}

function updatePipeline(stage, status) {
  // stage: 'csv','analyzer','graph','query','answer'
  // status: 'idle','active','done'
  const map = {
    csv: { el: 'pipe-csv', stat: 'pipeStatusCsv' },
    analyzer: { el: 'pipe-analyzer', stat: 'pipeStatusAnalyzer' },
    graph: { el: 'pipe-graph', stat: 'pipeStatusGraph' },
    query: { el: 'pipe-query', stat: 'pipeStatusQuery' },
    answer: { el: 'pipe-answer', stat: 'pipeStatusAnswer' },
  };
  const m = map[stage];
  if (!m) return;
  const el = document.getElementById(m.el);
  const stat = document.getElementById(m.stat);
  if (el) { el.className = `pipeline-stage ${status === 'active' || status === 'done' ? status : ''}`; }
  if (stat) {
    stat.className = `pipeline-status ${status}`;
    stat.textContent = status === 'idle' ? 'Idle' : status === 'active' ? 'Processing' : 'Done';
  }
}

function animatePipeline() {
  const stages = ['csv', 'analyzer', 'graph', 'query', 'answer'];
  stages.forEach(s => updatePipeline(s, 'idle'));
  let i = 0;
  const interval = setInterval(() => {
    if (i > 0) updatePipeline(stages[i - 1], 'done');
    if (i < stages.length) { updatePipeline(stages[i], 'active'); i++; }
    else clearInterval(interval);
  }, 400);
}

/* ============================================================
   DATASET EXPLORER
   ============================================================ */
function renderExplorer() {
  const ds = AppState.dataset;
  const ex = AppState.explorer;
  const noData = document.getElementById('explorerNoData');
  const table = document.getElementById('dataTable');
  const pagination = document.getElementById('pagination');

  if (!ds) {
    noData.style.display = '';
    table.style.display = 'none';
    pagination.style.display = 'none';
    document.getElementById('explorerRowCount').textContent = '0 records';
    document.getElementById('explorerColCount').textContent = '0 columns';
    return;
  }

  noData.style.display = 'none';
  table.style.display = '';

  document.getElementById('explorerRowCount').textContent = `${ex.filteredRows.length} records`;
  document.getElementById('explorerColCount').textContent = `${ds.headers.length} columns`;

  // Render header
  const thead = document.getElementById('tableHead');
  thead.innerHTML = '';
  const tr = document.createElement('tr');
  ds.headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    if (ex.sortCol === h) th.className = `sort-${ex.sortDir}`;
    th.addEventListener('click', () => sortExplorer(h));
    tr.appendChild(th);
  });
  thead.appendChild(tr);

  // Pagination
  const total = ex.filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / ex.pageSize));
  ex.currentPage = Math.min(ex.currentPage, totalPages);
  const start = (ex.currentPage - 1) * ex.pageSize;
  const pageRows = ex.filteredRows.slice(start, start + ex.pageSize);

  document.getElementById('currentPage').textContent = ex.currentPage;
  document.getElementById('totalPages').textContent = totalPages;
  document.getElementById('prevPage').disabled = ex.currentPage <= 1;
  document.getElementById('nextPage').disabled = ex.currentPage >= totalPages;

  // Render body
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  pageRows.forEach(row => {
    const tr = document.createElement('tr');
    ds.headers.forEach(h => {
      const td = document.createElement('td');
      const val = row[h];
      if (val === '' || val === null || val === undefined) {
        td.innerHTML = '<span class="empty-cell">—</span>';
      } else {
        td.textContent = String(val);
        td.title = String(val);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  pagination.style.display = totalPages > 1 ? '' : 'none';
}

function filterExplorer(query) {
  const ds = AppState.dataset;
  const ex = AppState.explorer;
  if (!ds) return;
  const q = query.toLowerCase().trim();
  ex.filteredRows = q === ''
    ? [...ds.rows]
    : ds.rows.filter(row =>
        ds.headers.some(h => String(row[h] || '').toLowerCase().includes(q))
      );
  ex.currentPage = 1;
  renderExplorer();
}

function sortExplorer(col) {
  const ex = AppState.explorer;
  if (ex.sortCol === col) {
    ex.sortDir = ex.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    ex.sortCol = col;
    ex.sortDir = 'asc';
  }
  ex.filteredRows.sort((a, b) => {
    let va = a[col] || '', vb = b[col] || '';
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) { va = na; vb = nb; }
    if (va < vb) return ex.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return ex.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  renderExplorer();
}

/* ============================================================
   GRAPH VIEW SETUP
   ============================================================ */
function setupGraph() {
  const ds = AppState.dataset;
  const noData = document.getElementById('graphNoData');

  if (!ds) {
    noData.style.display = '';
    return;
  }

  noData.style.display = 'none';
  const canvas = document.getElementById('graphCanvas');
  const container = document.getElementById('canvasContainer');
  canvas.width = container.offsetWidth || 800;
  canvas.height = container.offsetHeight || 500;

  const gv = AppState.graphView;
  gv.zoom = 1; gv.panX = 0; gv.panY = 0;
  gv.hoveredNode = null; gv.selectedNode = null;

  const graphData = AppState.graph;
  if (!graphData || graphData.nodes.length === 0) return;

  // Deep copy nodes for layout
  const nodes = graphData.nodes.map(n => ({ ...n }));
  const edges = graphData.edges.map(e => ({ ...e }));
  layoutGraph(nodes, edges, canvas.width, canvas.height);

  gv.nodes = nodes;
  gv.edges = edges;

  renderGraph();
  setupGraphInteractions(canvas);
}

function setupGraphInteractions(canvas) {
  const gv = AppState.graphView;

  function getNodeAt(mx, my) {
    // Convert mouse to canvas coords
    const cx = (mx - gv.panX) / gv.zoom;
    const cy = (my - gv.panY) / gv.zoom;
    return gv.nodes.find(n => {
      const r = n.type === 'category' ? 14 : 9;
      return Math.hypot(n.x - cx, n.y - cy) < r + 4;
    });
  }

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (gv.isDragging) {
      gv.panX += mx - gv.dragStart.x;
      gv.panY += my - gv.dragStart.y;
      gv.dragStart = { x: mx, y: my };
      renderGraph();
      return;
    }

    const node = getNodeAt(mx, my);
    gv.hoveredNode = node;
    canvas.style.cursor = node ? 'pointer' : 'grab';
    renderGraph();
  });

  canvas.addEventListener('mousedown', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);
    if (node) {
      gv.selectedNode = node;
      showNodePanel(node);
    } else {
      gv.isDragging = true;
      gv.dragStart = { x: mx, y: my };
      canvas.style.cursor = 'grabbing';
    }
    renderGraph();
  });

  canvas.addEventListener('mouseup', () => {
    gv.isDragging = false;
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    gv.zoom = Math.min(4, Math.max(0.2, gv.zoom * zoomDelta));
    renderGraph();
  }, { passive: false });

  // Touch support
  let lastTouch = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && lastTouch) {
      const dx = e.touches[0].clientX - lastTouch.x;
      const dy = e.touches[0].clientY - lastTouch.y;
      gv.panX += dx; gv.panY += dy;
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      renderGraph();
    }
  }, { passive: true });

  canvas.addEventListener('touchend', () => { lastTouch = null; });
}

function showNodePanel(node) {
  const panelBody = document.getElementById('panelBody');
  const props = node.properties || {};
  const connections = AppState.graphView.edges
    .filter(e => e.from === node.id || e.to === node.id)
    .map(e => {
      const otherId = e.from === node.id ? e.to : e.from;
      const other = AppState.graphView.nodes.find(n => n.id === otherId);
      return other ? other.label : otherId;
    });

  panelBody.innerHTML = `
    <div class="panel-node-type">${node.type.toUpperCase()}</div>
    <div class="panel-node-name">${node.label}</div>
    <div class="panel-props">
      ${Object.entries(props).map(([k, v]) => `
        <div class="panel-prop">
          <span class="prop-key">${k}</span>
          <span class="prop-val">${v !== '' ? v : '—'}</span>
        </div>
      `).join('')}
    </div>
    ${connections.length > 0 ? `
      <div class="panel-connections">
        <div class="panel-conn-label">Connected to (${connections.length})</div>
        ${connections.slice(0, 20).map(c => `<span class="conn-chip">${c}</span>`).join('')}
      </div>
    ` : ''}
  `;
}

/* ============================================================
   CHAT / ASK YOUR DATA
   ============================================================ */
function renderExampleChips() {
  const container = document.getElementById('exampleChips');
  const examples = AppState.dataset
    ? generateExamples()
    : ['Upload a dataset first', 'Load sample data', 'What columns are available?'];
  container.innerHTML = '';
  examples.slice(0, 6).forEach(ex => {
    const chip = document.createElement('button');
    chip.className = 'example-chip';
    chip.textContent = ex;
    chip.addEventListener('click', () => {
      document.getElementById('questionInput').value = ex;
      submitQuestion(ex);
    });
    container.appendChild(chip);
  });
}

function generateExamples() {
  const ds = AppState.dataset;
  if (!ds) return [];
  const { headers, analysis } = ds;
  const catCols = headers.filter(h => analysis.columns[h].type === 'CATEGORY');
  const numCols = headers.filter(h => analysis.columns[h].type === 'NUMBER');
  const examples = [`How many records are there?`, `What columns are available?`, `Show all data`];
  if (catCols.length > 0) {
    const col = catCols[0];
    const val = analysis.columns[col].values[0];
    if (val) examples.push(`How many ${val} are there?`);
    examples.push(`What ${col}s exist?`);
    examples.push(`How many records in each ${col}?`);
  }
  if (numCols.length > 0) {
    examples.push(`What is the average ${numCols[0]}?`);
  }
  return examples;
}

function submitQuestion(question) {
  if (!question.trim()) return;
  const chatMessages = document.getElementById('chatMessages');
  const welcome = document.getElementById('chatWelcome');
  if (welcome) welcome.style.display = 'none';

  // User message
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-message';
  userDiv.innerHTML = `<div class="msg-user">${escapeHtml(question)}</div>`;
  chatMessages.appendChild(userDiv);

  // Process
  const result = processQuestion(question);
  const grounded = checkGrounding(result);
  AppState.queryCount++;

  // Save to history
  const historyEntry = {
    question,
    timestamp: new Date().toISOString(),
    grounded,
  };
  AppState.queryHistory.unshift(historyEntry);
  saveToLocalStorage();
  updateStats();

  // Assistant message
  const assistDiv = document.createElement('div');
  assistDiv.className = 'chat-message msg-assistant';

  let rawHtml = '';
  if (result.raw !== null && result.raw !== undefined) {
    if (result.type === 'table' && Array.isArray(result.raw) && result.raw.length > 0) {
      const tableHeaders = Object.keys(result.raw[0]);
      rawHtml = `
        <div class="msg-raw">
          <div class="raw-header">Raw Result</div>
          <div class="raw-code" style="padding:0;overflow-x:auto;">
            <table class="msg-table">
              <thead><tr>${tableHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
              <tbody>${result.raw.map(row => `<tr>${tableHeaders.map(h => `<td>${escapeHtml(String(row[h] || '—'))}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`;
    } else {
      rawHtml = `
        <div class="msg-raw">
          <div class="raw-header">Raw Result</div>
          <div class="raw-code">${escapeHtml(JSON.stringify(result.raw, null, 2))}</div>
        </div>`;
    }
  }

  assistDiv.innerHTML = `
    <div class="msg-assistant-inner">
      <div class="msg-answer">${result.answer}</div>
      <div class="msg-grounding ${grounded ? 'grounded' : 'not-grounded'}">
        ${grounded ? '✓ Grounded in Dataset' : '⚠ Information Not Available in Dataset'}
      </div>
      <div class="msg-cypher">
        <div class="cypher-header">Generated Cypher</div>
        <div class="cypher-code">${escapeHtml(result.cypher)}</div>
      </div>
      ${rawHtml}
    </div>`;

  chatMessages.appendChild(assistDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  document.getElementById('questionInput').value = '';
  renderHistoryList();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
   QUERY HISTORY RENDERING
   ============================================================ */
function renderHistoryList() {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  if (AppState.queryHistory.length === 0) {
    empty.style.display = '';
    list.innerHTML = '';
    list.appendChild(empty);
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = '';
  AppState.queryHistory.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const time = new Date(entry.timestamp).toLocaleTimeString();
    item.innerHTML = `
      <div class="history-item-left">
        <span class="history-q">${escapeHtml(entry.question)}</span>
        <span class="history-time">${time}</span>
      </div>
      <span class="history-badge ${entry.grounded ? 'grounded' : 'not-grounded'}">
        ${entry.grounded ? '✓ Grounded' : '⚠ Not Grounded'}
      </span>
    `;
    item.addEventListener('click', () => {
      navigateTo('ask');
      setTimeout(() => submitQuestion(entry.question), 100);
    });
    list.appendChild(item);
  });
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function navigateTo(section) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  // Hide all sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.add('active');

  AppState.currentSection = section;

  // Update page title
  const titles = {
    overview: ['Overview', 'Data Intelligence Platform'],
    upload: ['Upload Dataset', 'Add a new CSV file'],
    explorer: ['Dataset Explorer', 'Browse and search your data'],
    graph: ['Graph View', 'Visual relationship explorer'],
    ask: ['Ask Your Data', 'Natural language query engine'],
    history: ['Query History', 'Past questions and answers'],
    status: ['System Status', 'Browser-based components'],
  };
  const [title, sub] = titles[section] || ['Overview', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = sub;

  // Section-specific actions
  if (section === 'graph') {
    setTimeout(setupGraph, 50);
  }
  if (section === 'explorer') {
    if (AppState.dataset && AppState.explorer.filteredRows.length === 0) {
      AppState.explorer.filteredRows = [...AppState.dataset.rows];
    }
    renderExplorer();
  }
  if (section === 'ask') {
    renderExampleChips();
    if (AppState.dataset) {
      const welcome = document.getElementById('chatWelcomeMsg');
      if (welcome) welcome.textContent = `Dataset "${AppState.dataset.filename}" is loaded. Ask me anything!`;
    }
  }
  if (section === 'history') {
    renderHistoryList();
  }
  if (section === 'overview') {
    updateOverviewNoDataset();
  }

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

/* ============================================================
   DATASET LOADING
   ============================================================ */
function loadDataset(csvText, filename) {
  try {
    const { headers, rows } = parseCSV(csvText);
    const analysis = analyzeDataset(headers, rows);
    const graph = generateGraph(headers, rows, analysis);

    AppState.dataset = { filename, headers, rows, analysis };
    AppState.graph = graph;
    AppState.explorer.filteredRows = [...rows];
    AppState.explorer.currentPage = 1;
    AppState.explorer.sortCol = null;

    saveToLocalStorage();
    updateStats();
    updateOverviewNoDataset();
    animatePipeline();

    showToast(`✓ Dataset loaded: ${rows.length} records, ${headers.length} columns`, 'success');
    return true;
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error', 5000);
    return false;
  }
}

function loadSampleDataset() {
  loadDataset(SAMPLE_CSV, 'sample_employees.csv');
}

function clearDataset() {
  if (!confirm('Are you sure you want to clear the current dataset? This cannot be undone.')) return;
  AppState.dataset = null;
  AppState.graph = null;
  AppState.explorer.filteredRows = [];
  AppState.explorer.currentPage = 1;
  AppState.graphView.nodes = [];
  AppState.graphView.edges = [];
  clearLocalStorage();
  updateStats();
  updateOverviewNoDataset();
  renderExplorer();
  const canvas = document.getElementById('graphCanvas');
  if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  document.getElementById('graphNoData').style.display = '';
  document.getElementById('fileInfoPanel').style.display = 'none';
  document.getElementById('uploadZone').style.display = '';
  // Reset pipeline
  ['csv','analyzer','graph','query','answer'].forEach(s => updatePipeline(s, 'idle'));
  showToast('Dataset cleared.', 'info');
}

/* ============================================================
   FILE UPLOAD HANDLING
   ============================================================ */
function handleFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please upload a .csv file.', 'error');
    return;
  }
  if (file.size === 0) {
    showToast('The file is empty.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const ok = loadDataset(text, file.name);
    if (ok) {
      showFileInfo(file, AppState.dataset);
    }
  };
  reader.onerror = () => showToast('Failed to read file.', 'error');
  reader.readAsText(file, 'UTF-8');
}

function showFileInfo(file, ds) {
  document.getElementById('uploadZone').style.display = 'none';
  const panel = document.getElementById('fileInfoPanel');
  panel.style.display = '';
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatBytes(file.size);
  document.getElementById('fileRows').textContent = ds.rows.length.toLocaleString();
  document.getElementById('fileCols').textContent = ds.headers.length;
  document.getElementById('fileStatusText').textContent = 'Valid';

  // Detected headers
  const headersEl = document.getElementById('detectedHeaders');
  headersEl.innerHTML = `
    <div class="detected-headers-label">Detected Headers</div>
    <div class="header-chips">${ds.headers.map(h => `<span class="header-chip">${escapeHtml(h)}</span>`).join('')}</div>
  `;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ============================================================
   HERO CANVAS ANIMATION
   ============================================================ */
function startHeroAnimation() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const nodes = [];
  for (let i = 0; i < 18; i++) {
    nodes.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: Math.random() * 4 + 2,
      color: Math.random() > 0.5 ? '#00d4ff' : '#7c3aed',
    });
  }

  function anim() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,14,26,0.85)';
    ctx.fillRect(0, 0, W, H);

    // Draw edges
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 90) {
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(0,212,255,${0.3 * (1 - dist / 90)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }
    // Draw nodes
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    });
    requestAnimationFrame(anim);
  }
  anim();
}

/* ============================================================
   INIT / BOOT
   ============================================================ */
function init() {
  // Load from localStorage
  loadHistoryFromStorage();
  const restored = loadFromLocalStorage();
  if (restored && AppState.dataset) {
    // Regenerate graph from restored dataset
    AppState.graph = generateGraph(AppState.dataset.headers, AppState.dataset.rows, AppState.dataset.analysis);
    AppState.explorer.filteredRows = [...AppState.dataset.rows];
    showToast(`Dataset restored: ${AppState.dataset.filename}`, 'info');
  }

  updateStats();
  updateOverviewNoDataset();
  startHeroAnimation();

  // ---- NAVIGATION
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  // ---- HERO BUTTONS
  document.getElementById('heroUploadBtn').addEventListener('click', () => navigateTo('upload'));
  document.getElementById('heroSampleBtn').addEventListener('click', () => { loadSampleDataset(); });
  document.getElementById('noticeUploadBtn').addEventListener('click', () => navigateTo('upload'));
  document.getElementById('noticeSampleBtn').addEventListener('click', () => { loadSampleDataset(); });

  // ---- UPLOAD
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  document.getElementById('uploadBrowseBtn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

  fileInput.addEventListener('change', e => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });

  document.getElementById('uploadSampleBtn').addEventListener('click', () => {
    loadSampleDataset();
    navigateTo('overview');
  });

  document.getElementById('exploreDataBtn').addEventListener('click', () => navigateTo('explorer'));
  document.getElementById('reuploadBtn').addEventListener('click', () => {
    document.getElementById('fileInfoPanel').style.display = 'none';
    uploadZone.style.display = '';
    fileInput.value = '';
  });

  // ---- CLEAR DATASET
  document.getElementById('clearDatasetBtn').addEventListener('click', clearDataset);

  // ---- EXPLORER
  document.getElementById('searchInput').addEventListener('input', e => filterExplorer(e.target.value));
  document.getElementById('prevPage').addEventListener('click', () => {
    if (AppState.explorer.currentPage > 1) { AppState.explorer.currentPage--; renderExplorer(); }
  });
  document.getElementById('nextPage').addEventListener('click', () => {
    const totalPages = Math.ceil(AppState.explorer.filteredRows.length / AppState.explorer.pageSize);
    if (AppState.explorer.currentPage < totalPages) { AppState.explorer.currentPage++; renderExplorer(); }
  });
  document.getElementById('explorerUploadLink').addEventListener('click', () => navigateTo('upload'));

  // ---- GRAPH
  document.getElementById('graphZoomIn').addEventListener('click', () => {
    AppState.graphView.zoom = Math.min(4, AppState.graphView.zoom * 1.2);
    renderGraph();
  });
  document.getElementById('graphZoomOut').addEventListener('click', () => {
    AppState.graphView.zoom = Math.max(0.2, AppState.graphView.zoom * 0.8);
    renderGraph();
  });
  document.getElementById('graphReset').addEventListener('click', () => {
    AppState.graphView.zoom = 1;
    AppState.graphView.panX = 0;
    AppState.graphView.panY = 0;
    AppState.graphView.selectedNode = null;
    AppState.graphView.hoveredNode = null;
    document.getElementById('panelBody').innerHTML = '<div class="panel-empty"><p>Click a node to see details</p></div>';
    renderGraph();
  });
  document.getElementById('graphRebuild').addEventListener('click', () => {
    if (AppState.dataset) setupGraph();
  });
  document.getElementById('graphUploadLink').addEventListener('click', () => navigateTo('upload'));

  // ---- ASK
  const sendBtn = document.getElementById('sendBtn');
  const questionInput = document.getElementById('questionInput');
  sendBtn.addEventListener('click', () => submitQuestion(questionInput.value.trim()));
  questionInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitQuestion(questionInput.value.trim()); }
  });

  // ---- HISTORY
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (!confirm('Clear all query history?')) return;
    AppState.queryHistory = [];
    AppState.queryCount = 0;
    saveToLocalStorage();
    updateStats();
    renderHistoryList();
    showToast('History cleared.', 'info');
  });

  // ---- MOBILE SIDEBAR
  document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('active');
  });
  document.getElementById('sidebarOverlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
  });

  // ---- FONT SIZE
  initFontSize();

  // ---- CANVAS RESIZE
  window.addEventListener('resize', () => {
    if (AppState.currentSection === 'graph') {
      setTimeout(setupGraph, 100);
    }
  });

  console.log('CSV Graph Assistant initialized. Browser-only mode active.');
}

/* ============================================================
   FONT SIZE PICKER
   ============================================================ */
const FONT_SIZE_KEY     = 'csvga_fontSize';
const FONT_SIZE_MIN     = 80;
const FONT_SIZE_MAX     = 150;
const FONT_SIZE_DEFAULT = 100;
const FONT_SIZE_STEP    = 5;

function applyFontSize(pct) {
  // Drive --fs-scale on :root so every calc(Xpx * var(--fs-scale)) in CSS responds
  document.documentElement.style.setProperty('--fs-scale', (pct / 100).toFixed(3));
  // Also keep html font-size in sync for any rem-based values
  document.documentElement.style.fontSize = pct + '%';

  // Update trigger label
  const tl = document.getElementById('fsTriggerLabel');
  if (tl) tl.textContent = pct + '%';

  // Update panel value
  const cv = document.getElementById('fsCurrentVal');
  if (cv) cv.textContent = pct;

  // Sync slider position + fill track
  const slider = document.getElementById('fsSlider');
  if (slider) {
    slider.value = pct;
    slider.setAttribute('aria-valuenow', pct);
    const pctFill = ((pct - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN) * 100).toFixed(1) + '%';
    slider.style.background =
      `linear-gradient(to right, var(--cyan) 0%, var(--cyan) ${pctFill}, rgba(255,255,255,0.1) ${pctFill}, rgba(255,255,255,0.1) 100%)`;
  }

  // Highlight matching preset chip
  document.querySelectorAll('.fs-preset').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.size) === pct);
  });
}

function setFontSize(pct) {
  pct = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, pct));
  localStorage.setItem(FONT_SIZE_KEY, String(pct));
  applyFontSize(pct);
}

function initFontSize() {
  const saved = parseInt(localStorage.getItem(FONT_SIZE_KEY) || FONT_SIZE_DEFAULT, 10);
  applyFontSize(saved);

  const trigger   = document.getElementById('fsTrigger');
  const panel     = document.getElementById('fsPanel');
  const closeBtn  = document.getElementById('fsPanelClose');
  const slider    = document.getElementById('fsSlider');
  const resetBtn  = document.getElementById('fsReset');

  // Toggle panel open/close
  function openPanel() {
    panel.style.display = '';
    trigger.setAttribute('aria-expanded', 'true');
    // re-sync slider fill on open
    const cur = parseInt(localStorage.getItem(FONT_SIZE_KEY) || FONT_SIZE_DEFAULT, 10);
    applyFontSize(cur);
  }
  function closePanel() {
    panel.style.display = 'none';
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = panel.style.display !== 'none';
    isOpen ? closePanel() : openPanel();
  });

  closeBtn.addEventListener('click', closePanel);

  // Close when clicking outside
  document.addEventListener('click', e => {
    if (!document.getElementById('fsPicker').contains(e.target)) closePanel();
  });

  // Escape key closes
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanel();
  });

  // Slider input — live update
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    setFontSize(v);
  });

  // Preset chips
  document.querySelectorAll('.fs-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = parseInt(btn.dataset.size, 10);
      setFontSize(size);
      showToast('Font size set to ' + size + '%', 'info', 1500);
    });
  });

  // Reset button
  resetBtn.addEventListener('click', () => {
    setFontSize(FONT_SIZE_DEFAULT);
    showToast('Font size reset to 100%', 'info', 1500);
  });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
