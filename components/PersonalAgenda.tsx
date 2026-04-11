
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AgendaItem, User, AgendaIssue, Media, AgendaTopic } from '../types';
import { PlusCircleIcon, TrashIcon, CheckCircleIcon, CalendarDaysIcon, BellIcon, RefreshIcon, XIcon, CameraIcon, CameraIcon as PhotoIcon, SearchIcon, ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon, PrinterIcon, PencilIcon, SparklesIcon } from './icons';
import { generateUUID } from '../App';
import { fetchWithRetry, SCRIPT_URL } from '../utils/api';
import Modal from './Modal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import PhotoEditor from './PhotoEditor';

interface PersonalAgendaProps {
  user: User;
  agenda: AgendaItem[];
  agendaIssues?: AgendaIssue[];
  onUpdateAgenda: (items: AgendaItem[]) => void;
  onUpdateAgendaIssues: (items: AgendaIssue[]) => void;
  viewMode?: 'REMINDERS' | 'LIST';
}

const compressImage = (file: File): Promise<{ base64: string; mimeType: string }> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
       const reader = new FileReader();
       reader.readAsDataURL(file);
       reader.onload = () => resolve({ base64: reader.result as string, mimeType: file.type });
       reader.onerror = error => reject(error);
       return;
    }
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target?.result as string; };
    reader.onerror = (err) => reject(err);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 1280;
      if (width > height) {
        if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
      } else {
        if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
      resolve({ base64: compressedBase64, mimeType: 'image/jpeg' });
    };
    reader.readAsDataURL(file);
  });
};

const getDisplayableDriveUrl = (url: string): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const driveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/;
  const match = url.match(driveRegex);
  if (match && match[1]) return `https://lh3.googleusercontent.com/d/${match[1]}`;
  return url;
};

// Helper para pegar data local sem erro de fuso
const getLocalYYYYMMDD = () => {
    const now = new Date();
    return now.toLocaleDateString('en-CA'); // Retorna YYYY-MM-DD local
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const PersonalAgenda: React.FC<PersonalAgendaProps> = ({ user, agenda, agendaIssues = [], onUpdateAgenda, onUpdateAgendaIssues, viewMode = 'REMINDERS' }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [filter, setFilter] = useState<'PENDING' | 'DONE' | 'ASTECA'>('PENDING');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // PDF Report Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportStatus, setReportStatus] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');
  const [reportClient, setReportClient] = useState('');

  // Reminders Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Issues Form State
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null);
  const [issueClient, setIssueClient] = useState('');
  const [issueDate, setIssueDate] = useState(getLocalYYYYMMDD());
  const [formTopics, setFormTopics] = useState<{ id: string; description: string; media: Media[]; status: 'Pending' | 'Resolved'; date: string; isAsteca?: boolean }[]>([
    { id: generateUUID(), description: '', media: [], status: 'Pending', date: getLocalYYYYMMDD(), isAsteca: false }
  ]);
  const [uploadingTopicId, setUploadingTopicId] = useState<string | null>(null);
  const [editingMedia, setEditingMedia] = useState<{ media: Media; topicId: string } | null>(null);
  const [editingTopic, setEditingTopic] = useState<{ issueId: string; topic: AgendaTopic } | null>(null);
  const [viewingTopicDetail, setViewingTopicDetail] = useState<{ issueId: string; topic: AgendaTopic } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Media Viewer State
  const [viewingMedia, setViewingMedia] = useState<{ list: Media[], index: number; topicId?: string; issue?: AgendaIssue } | null>(null);
  const [viewingClientName, setViewingClientName] = useState<string | null>(null);
  const [isProfessionalizing, setIsProfessionalizing] = useState<string | null>(null); // topicId or 'reminder'
  const [aiError, setAiError] = useState<string | null>(null);

  const handleProfessionalizeText = async (text: string, type: 'topic' | 'reminder', id?: string) => {
    if (!text.trim()) return;
    
    const loadingId = id || 'reminder';
    setIsProfessionalizing(loadingId);
    setAiError(null);
    
    try {
      const { professionalizeText } = await import('../src/services/geminiService');
      const improvedText = await professionalizeText(text);
      
      if (improvedText) {
        if (type === 'topic' && id) {
          setFormTopics(prev => prev.map(t => t.id === id ? { ...t, description: improvedText } : t));
        } else if (type === 'reminder') {
          setDescription(improvedText);
        }
      } else {
        throw new Error("A IA não retornou um texto válido.");
      }
    } catch (error: any) {
      console.error("Erro ao profissionalizar texto:", error);
      setAiError(error.message || "Ocorreu um erro ao processar o texto com IA.");
      // Clear error after 5 seconds
      setTimeout(() => setAiError(null), 5000);
    } finally {
      setIsProfessionalizing(null);
    }
  };

  const uniqueClients = useMemo(() => {
      const clients = new Set(agendaIssues.map(i => i.clientName));
      return Array.from(clients).sort();
  }, [agendaIssues]);

  const sortedReminders = useMemo(() => {
    return [...agenda]
      .filter(item => {
        if (filter === 'ASTECA') return false; // ASTECA is for LIST view
        return filter === 'PENDING' ? item.status === 'Pending' : item.status === 'Done';
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [agenda, filter]);

  const sortedIssues = useMemo(() => {
    return [...agendaIssues]
      .filter(item => {
        if (filter === 'ASTECA') {
          // Check if any topic in this issue is an open ASTECA
          return item.topics?.some(t => t.isAsteca && t.status === 'Pending');
        }
        const hasPending = item.topics?.some(t => t.status === 'Pending');
        return filter === 'PENDING' ? hasPending : !hasPending;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [agendaIssues, filter]);

  const calculateDaysOpen = (createdAt: string) => {
    const start = new Date(createdAt);
    const now = new Date();
    const diff = Math.abs(now.getTime() - start.getTime());
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const calculateDaysFromDate = (dateStr: string) => {
      if (!dateStr) return 0;
      const start = new Date(dateStr + 'T12:00:00Z'); // Meio dia para evitar pulo de fuso
      const now = new Date();
      now.setHours(12, 0, 0, 0);
      const diff = now.getTime() - start.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      return days < 0 ? 0 : days;
  };

  const clientSummaries = useMemo(() => {
    const groups: Record<string, AgendaIssue[]> = {};
    agendaIssues.forEach(issue => {
      // Normalize old data
      const normalized = issue.topics ? {
          ...issue,
          topics: issue.topics.map(t => ({
              ...t,
              date: t.date || issue.date // Fallback to issue date if topic date is missing
          }))
      } : {
          ...issue,
          topics: [{
              id: issue.id, // Use issue ID as topic ID for stable virtual topic
              description: (issue as any).description || '',
              media: (issue as any).media || [],
              status: (issue as any).status || 'Pending',
              date: issue.date
          }]
      } as AgendaIssue;

      if (!groups[normalized.clientName]) groups[normalized.clientName] = [];
      groups[normalized.clientName].push(normalized);
    });

    return Object.entries(groups).map(([name, issues]) => {
      // Filter topics based on the main filter (PENDING/DONE/ASTECA)
      const filteredIssues = issues.map(issue => ({
        ...issue,
        topics: issue.topics.filter(t => {
          if (filter === 'ASTECA') return t.isAsteca && t.status === 'Pending';
          return filter === 'PENDING' ? t.status === 'Pending' : t.status === 'Resolved';
        })
      })).filter(issue => issue.topics.length > 0);
      
      if (filteredIssues.length === 0) return null;

      // Find oldest issue for the summary
      const oldest = [...filteredIssues].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
      const totalTopics = filteredIssues.reduce((sum, issue) => sum + issue.topics.length, 0);

      return {
        name,
        oldestDate: oldest.date,
        daysOpen: calculateDaysFromDate(oldest.date),
        totalTopics,
        issues: filteredIssues.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.daysOpen - a.daysOpen);
  }, [agendaIssues, filter]);

  const viewingClientItems = useMemo(() => {
    if (!viewingClientName) return null;
    return clientSummaries.find(s => s.name === viewingClientName) || null;
  }, [viewingClientName, clientSummaries]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewingClientItems && scrollContainerRef.current) {
      // No longer need to scroll to row since it's a modal
    }
  }, [viewingClientItems]);

  const handleAddReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !dueDate) return;

    const newItem: AgendaItem = {
      id: generateUUID(),
      userId: user.id,
      title: title.trim(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
      dueDate: new Date(dueDate).toISOString(),
      status: 'Pending',
      notified: false
    };

    onUpdateAgenda([newItem, ...agenda]);
    setTitle('');
    setDescription('');
    setDueDate('');
    setIsAdding(false);
  };

  const handleAddIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueClient || !issueDate || formTopics.some(t => !t.description)) {
        alert("Preencha o cliente, a data e a descrição de todos os tópicos.");
        return;
    }

    if (editingIssueId) {
        const updatedIssues = agendaIssues.map(issue => 
            issue.id === editingIssueId 
            ? { ...issue, clientName: issueClient.trim(), date: issueDate, topics: formTopics }
            : issue
        );
        onUpdateAgendaIssues(updatedIssues);
        setEditingIssueId(null);
    } else {
        const newIssue: AgendaIssue = {
            id: generateUUID(),
            userId: user.id,
            clientName: issueClient.trim(),
            date: issueDate,
            topics: formTopics,
            createdAt: new Date().toISOString()
        };
        onUpdateAgendaIssues([newIssue, ...agendaIssues]);
    }

    setIssueClient('');
    setIssueDate(getLocalYYYYMMDD());
    setFormTopics([{ id: generateUUID(), description: '', media: [], status: 'Pending', date: getLocalYYYYMMDD(), isAsteca: false }]);
    setIsAdding(false);
  };

  const handleEditIssue = (issue: AgendaIssue) => {
      // Encontra a issue original para não perder os tópicos que foram filtrados na view atual
      const originalIssue = agendaIssues.find(i => i.id === issue.id) || issue;
      
      setEditingIssueId(originalIssue.id);
      setIssueClient(originalIssue.clientName);
      setIssueDate(originalIssue.date);
      
      // Robust normalization for editing
      const topics = originalIssue.topics && originalIssue.topics.length > 0 
        ? originalIssue.topics.map(t => ({ ...t, date: t.date || originalIssue.date, isAsteca: !!t.isAsteca })) 
        : [{ 
            id: originalIssue.id, 
            description: (originalIssue as any).description || '', 
            media: (originalIssue as any).media || [], 
            status: (originalIssue as any).status || 'Pending', 
            date: originalIssue.date,
            isAsteca: false
          }];
          
      setFormTopics(topics);
      setIsAdding(true);
  };

  const handleEditTopic = (issueId: string, topic: AgendaTopic) => {
    setEditingTopic({ issueId, topic });
  };

  const handleDeleteTopic = (issueId: string, topicId: string) => {
    const updatedIssues = agendaIssues.map(issue => {
      if (issue.id === issueId) {
        return {
          ...issue,
          topics: issue.topics.filter(t => t.id !== topicId)
        };
      }
      return issue;
    }).filter(issue => issue.topics.length > 0);
    onUpdateAgendaIssues(updatedIssues);
  };

  const handleSaveSingleTopic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTopic) return;

    const { issueId, topic } = editingTopic;
    const updatedIssues = agendaIssues.map(issue => {
      if (issue.id === issueId) {
        return {
          ...issue,
          topics: issue.topics.map(t => t.id === topic.id ? topic : t)
        };
      }
      return issue;
    });

    onUpdateAgendaIssues(updatedIssues);
    setEditingTopic(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, topicId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingTopicId(topicId);
    const tempId = generateUUID();
    const localUrl = URL.createObjectURL(file);
    const tempMedia: Media = { id: tempId, type: 'image', url: localUrl, name: file.name };
    
    setFormTopics(prev => prev.map(t => t.id === topicId ? { ...t, media: [...t.media, tempMedia] } : t));

    try {
      const { base64: base64Data, mimeType } = await compressImage(file);
      const response = await fetchWithRetry(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'UPLOAD_FILE', data: { base64Data, fileName: file.name, mimeType: mimeType } }),
      });
      const result = await response.json();
      if (!result.success || !result.url) throw new Error(result.message || 'Falha no upload');
      
      setFormTopics(prev => prev.map(t => t.id === topicId ? { 
        ...t, 
        media: t.media.map(m => m.id === tempId ? { ...m, url: result.url, originalUrl: result.url } : m) 
      } : t));
    } catch (error: any) {
        alert(`Erro no upload: ${error.message}`);
        setFormTopics(prev => prev.map(t => t.id === topicId ? { 
            ...t, 
            media: t.media.filter(m => m.id !== tempId) 
        } : t));
    } finally {
        setUploadingTopicId(null);
    }
  };

  const toggleStatus = (id: string) => {
    const updated = agenda.map(item => 
      item.id === id ? { ...item, status: (item.status === 'Pending' ? 'Done' : 'Pending') as 'Pending' | 'Done' } : item
    );
    onUpdateAgenda(updated);
  };

  const toggleTopicStatus = (issueId: string, topicId: string) => {
    const updated = agendaIssues.map(issue => {
        if (issue.id === issueId) {
            // Robust normalization for status toggle
            const topics = issue.topics && issue.topics.length > 0
                ? issue.topics
                : [{
                    id: issue.id,
                    description: (issue as any).description || '',
                    media: (issue as any).media || [],
                    status: (issue as any).status || 'Pending',
                    date: issue.date
                }];

            return {
                ...issue,
                topics: topics.map(t => t.id === topicId ? { ...t, status: t.status === 'Pending' ? 'Resolved' : 'Pending' } : t)
            };
        }
        return issue;
    });
    onUpdateAgendaIssues(updated);
  };

  const deleteItem = (id: string) => {
    onUpdateAgenda(agenda.filter(i => i.id !== id));
  };

  const deleteIssue = (id: string) => {
    onUpdateAgendaIssues(agendaIssues.filter(i => i.id !== id));
  };

  const handleGeneratePDF = () => {
    const doc = new jsPDF();
    
    // Filter issues based on date range if provided
    let filteredIssues = agendaIssues.map(issue => {
        // Normalize
        const normalized = issue.topics ? {
            ...issue,
            topics: issue.topics.map(t => ({ ...t, date: t.date || issue.date }))
        } : {
            ...issue,
            topics: [{
                id: generateUUID(),
                description: (issue as any).description || '',
                media: (issue as any).media || [],
                status: (issue as any).status || 'Pending',
                date: issue.date
            }]
        } as AgendaIssue;

        // Filter topics by status
        return {
            ...normalized,
            topics: normalized.topics.filter(t => {
                if (reportStatus === 'PENDING') return t.status === 'Pending';
                if (reportStatus === 'RESOLVED') return t.status === 'Resolved';
                return true;
            })
        };
    }).filter(i => i.topics.length > 0);

    if (startDate) {
        filteredIssues = filteredIssues.filter(i => i.date >= startDate);
    }
    if (endDate) {
        filteredIssues = filteredIssues.filter(i => i.date <= endDate);
    }

    // Filter by Client
    if (reportClient) {
        filteredIssues = filteredIssues.filter(i => i.clientName === reportClient);
    }
    
    // Sort by date desc
    filteredIssues.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Title
    doc.setFontSize(18);
    doc.text("Relatório de Pendências", 14, 20);
    
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, 14, 28);
    
    let filterText = "";
    if (startDate || endDate) {
        const startStr = startDate ? new Date(startDate + 'T12:00:00Z').toLocaleDateString('pt-BR') : 'Início';
        const endStr = endDate ? new Date(endDate + 'T12:00:00Z').toLocaleDateString('pt-BR') : 'Fim';
        filterText += `Período: ${startStr} até ${endStr} | `;
    }
    filterText += `Status: ${reportStatus === 'ALL' ? 'Todos' : (reportStatus === 'PENDING' ? 'Pendentes' : 'Resolvidos')}`;
    if (reportClient) filterText += ` | Cliente: ${reportClient}`;

    doc.text(filterText, 14, 34);

    // Flatten and Sort: ASTECA first, then date desc
    const flatTopics: any[] = [];
    filteredIssues.forEach(issue => {
        issue.topics.forEach(topic => {
            flatTopics.push({
                ...topic,
                clientName: issue.clientName
            });
        });
    });

    flatTopics.sort((a, b) => {
        if (a.isAsteca && !b.isAsteca) return -1;
        if (!a.isAsteca && b.isAsteca) return 1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const totalAsteca = flatTopics.filter(t => t.isAsteca).length;
    const totalGeneral = flatTopics.length;

    const tableColumn = ["Data", "Dias", "Cliente", "Descrição", "Status"];
    const tableRows: any[] = [];
    
    flatTopics.forEach(topic => {
        const topicDays = calculateDaysFromDate(topic.date);
        tableRows.push([
            new Date(topic.date + 'T12:00:00Z').toLocaleDateString('pt-BR'),
            `${topicDays}d`,
            topic.clientName,
            topic.isAsteca ? `[ASTECA] ${topic.description}` : topic.description,
            topic.status === 'Pending' ? 'Pendente' : 'Resolvido',
            topic.status, // Hidden column for styling
            topic.isAsteca // Hidden column for styling
        ]);
    });

    autoTable(doc, {
        head: [tableColumn],
        body: tableRows.map(row => row.slice(0, 5)),
        startY: 40,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 41, 59] }, // slate-800
        alternateRowStyles: { fillColor: [241, 245, 249] }, // slate-100
        didDrawCell: (data) => {
            if (data.row.section !== 'body') return;
            const rowIndex = data.row.index;
            const isResolved = tableRows[rowIndex][5] === 'Resolved';
            
            if (isResolved) {
                const { x, y, width, height } = data.cell;
                doc.setDrawColor(34, 197, 94);
                doc.setLineWidth(0.1);
                
                // Strike through each line of text in the cell
                const textLines = data.cell.text as string[];
                if (textLines && textLines.length > 0) {
                    const cellPadding = data.cell.styles.cellPadding as any;
                    const padding = typeof cellPadding === 'number' ? cellPadding : (cellPadding.top || 0);
                    const fontSize = data.cell.styles.fontSize;
                    // Distribution of lines within the cell height
                    const totalTextHeight = height - (padding * 2);
                    const lineSpacing = totalTextHeight / textLines.length;
                    
                    for (let i = 0; i < textLines.length; i++) {
                        // Adjust lineY to be centered on the text line
                        // fontSize is in points, convert to mm (approx / 2.83)
                        // Then take roughly half of that height for the middle
                        const textHeightMm = fontSize / 2.83;
                        const lineY = y + padding + (i * lineSpacing) + (textHeightMm / 2);
                        doc.line(x + 2, lineY, x + width - 2, lineY);
                    }
                }
            }
        },
        willDrawCell: (data) => {
            if (data.row.section !== 'body') return;
            const rowIndex = data.row.index;
            const isResolved = tableRows[rowIndex][5] === 'Resolved';
            const isAsteca = tableRows[rowIndex][6];
            if (isResolved) {
                doc.setTextColor(34, 197, 94);
            } else if (isAsteca) {
                doc.setTextColor(220, 38, 38); // red-600
            }
        }
    });

    // Summary at the end
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(220, 38, 38);
    doc.text(`Total de ASTECAS: ${totalAsteca}`, 14, finalY);
    doc.setTextColor(0, 0, 0);
    doc.text(`Total Geral de Pendências: ${totalGeneral}`, 14, finalY + 6);

    doc.save(`relatorio_pendencias_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const handleGeneratePDFWithPhotos = async () => {
    setIsGenerating(true);
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 14;
      let y = 20;

      // Filter issues (same logic as handleGeneratePDF)
      let filteredIssues = agendaIssues.map(issue => {
          const normalized = issue.topics ? {
              ...issue,
              topics: issue.topics.map(t => ({ ...t, date: t.date || issue.date }))
          } : {
              ...issue,
              topics: [{
                  id: generateUUID(),
                  description: (issue as any).description || '',
                  media: (issue as any).media || [],
                  status: (issue as any).status || 'Pending',
                  date: issue.date
              }]
          } as AgendaIssue;

          return {
              ...normalized,
              topics: normalized.topics.filter(t => {
                  if (reportStatus === 'PENDING') return t.status === 'Pending';
                  if (reportStatus === 'RESOLVED') return t.status === 'Resolved';
                  return true;
              })
          };
      }).filter(i => i.topics.length > 0);

      if (startDate) filteredIssues = filteredIssues.filter(i => i.date >= startDate);
      if (endDate) filteredIssues = filteredIssues.filter(i => i.date <= endDate);
      if (reportClient) filteredIssues = filteredIssues.filter(i => i.clientName === reportClient);
      
      // Flatten and Sort: ASTECA first, then date desc
      const flatTopics: any[] = [];
      filteredIssues.forEach(issue => {
          issue.topics.forEach(topic => {
              flatTopics.push({
                  ...topic,
                  clientName: issue.clientName
              });
          });
      });

      flatTopics.sort((a, b) => {
          if (a.isAsteca && !b.isAsteca) return -1;
          if (!a.isAsteca && b.isAsteca) return 1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      const totalAsteca = flatTopics.filter(t => t.isAsteca).length;
      const totalGeneral = flatTopics.length;

      // Header Background (Light)
      doc.setFillColor(241, 245, 249); // Slate-100
      doc.rect(0, 0, pageWidth, 25, 'F');
      
      // Title inside header
      const reportTitle = reportClient ? `Pendências - Obra: ${reportClient}` : "Relatório de Pendências";
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42); // Slate-900
      doc.text(reportTitle, margin, 14);
      
      // Generation Date inside header
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139); // Slate-500
      doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, margin, 20);
      
      y = 32;

      // Filter Info
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139); // Slate-500
      
      let filterText = "";
      if (startDate || endDate) {
          const startStr = startDate ? new Date(startDate + 'T12:00:00Z').toLocaleDateString('pt-BR') : 'Início';
          const endStr = endDate ? new Date(endDate + 'T12:00:00Z').toLocaleDateString('pt-BR') : 'Fim';
          filterText += `Período: ${startStr} até ${endStr} | `;
      }
      filterText += `Status: ${reportStatus === 'ALL' ? 'Todos' : (reportStatus === 'PENDING' ? 'Pendentes' : 'Resolvidos')}`;
      filterText += ` | Total de Pendências: ${totalGeneral} | Total ASTECAS: ${totalAsteca}`;
      doc.text(filterText, margin, y);
      
      y += 10;
      doc.setTextColor(0, 0, 0); // Reset text color

      let currentTopicIndex = 0;
      for (const topic of flatTopics) {
          currentTopicIndex++;
          // Check for page break (estimated minimum height for a block)
          if (y > pageHeight - 100) {
              doc.addPage();
              y = 20;
          }

          const startY = y;
          const padding = 5;
          
          // Description
          const isResolved = topic.status === 'Resolved';
          const isAsteca = topic.isAsteca;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          
          if (isResolved) {
              doc.setTextColor(34, 197, 94); // text-green-500
          } else if (isAsteca) {
              doc.setTextColor(220, 38, 38); // text-red-600
          } else {
              doc.setTextColor(0, 0, 0);
          }

          const descriptionText = isAsteca ? `[ASTECA] ${topic.description}` : topic.description;
          const splitDescription = doc.splitTextToSize(descriptionText, pageWidth - 2 * margin - (padding * 2));
          
          // Start description below the top margin to leave space for the badge
          const descY = y + padding + 8; 
          doc.text(splitDescription, margin + padding, descY);

          if (isResolved) {
              doc.setDrawColor(34, 197, 94);
              doc.setLineWidth(0.2);
              const actualLineHeight = doc.getLineHeight();
              const textHeightMm = doc.getFontSize() / 2.83;
              const strikeOffset = textHeightMm / 2;
              
              for (let i = 0; i < splitDescription.length; i++) {
                  const textWidth = doc.getTextWidth(splitDescription[i]);
                  const lineY = descY + (i * actualLineHeight) - strikeOffset;
                  doc.line(margin + padding, lineY, margin + padding + textWidth, lineY);
              }
          }

          y = descY + (splitDescription.length * 5) + 2;

          // Add Photos
          if (topic.media && topic.media.length > 0) {
              const imgSize = 70;
              const gap = 5;
              let x = margin + padding;

              for (const media of topic.media) {
                  if (x + imgSize > pageWidth - margin - padding) {
                      x = margin + padding;
                      y += imgSize + gap;
                  }

                  if (y + imgSize > pageHeight - margin) {
                      // If we need a new page for photos, we close the current box and start a new one on the next page
                      doc.setDrawColor(200);
                      doc.rect(margin, startY, pageWidth - 2 * margin, y - startY + 2);
                      
                      doc.addPage();
                      y = 20;
                      x = margin + padding;
                      // Note: This is a simplified approach, ideally the box would continue
                  }

                  try {
                      const url = getDisplayableDriveUrl(media.url);
                      let b64: string;
                      
                      if (url && url.startsWith('data:')) {
                          b64 = url;
                      } else {
                          const resp = await fetch(url!);
                          const blob = await resp.blob();
                          b64 = await blobToBase64(blob);
                      }
                      
                      doc.addImage(b64, 'JPEG', x, y, imgSize, imgSize, undefined, 'FAST');
                      doc.setDrawColor(220);
                      doc.rect(x, y, imgSize, imgSize);

                      if (isResolved) {
                          // Diagonal "CONCLUÍDO" stamp across the photo
                          doc.setTextColor(34, 197, 94); // text-green-500
                          doc.setFontSize(22);
                          doc.setFont("helvetica", "bold");
                          
                          const centerX = x + (imgSize / 2);
                          const centerY = y + (imgSize / 2);
                          
                          // Rotate text 45 degrees (bottom-left to top-right)
                          doc.text("CONCLUÍDO", centerX, centerY, { 
                              align: 'center', 
                              angle: 45
                          });
                      }

                      x += imgSize + gap;
                  } catch (e) {
                      console.error("Error adding image to PDF:", e);
                  }
              }
              y += imgSize + padding + 5;
          } else {
              y += padding + 5;
          }
          
          // Draw the box around the entire topic (description + photos)
          doc.setDrawColor(180);
          doc.setLineWidth(0.2);
          doc.rect(margin, startY, pageWidth - 2 * margin, y - startY);

          // Counter Badge (X de Y) - Professional Badge attached to the top line
          const counterText = `${currentTopicIndex} de ${totalGeneral}`;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7);
          const counterWidth = doc.getTextWidth(counterText) + 6;
          const badgeX = pageWidth - margin - counterWidth - 5;
          const badgeY = startY - 2.5; // Overlapping the top line
          
          doc.setFillColor(30, 41, 59); // Slate-800
          doc.roundedRect(badgeX, badgeY, counterWidth, 5, 1, 1, 'F');
          
          doc.setTextColor(255, 255, 255);
          doc.text(counterText, badgeX + 3, badgeY + 3.5);
          
          y += 10; // Space between boxes
      }

      // Final Summary for Photo Report
      if (y > pageHeight - 30) {
          doc.addPage();
          y = 20;
      }
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(220, 38, 38);
      doc.text(`Resumo Final:`, margin, y);
      doc.text(`Total de ASTECAS: ${totalAsteca}`, margin, y + 8);
      doc.setTextColor(0, 0, 0);
      doc.text(`Total Geral de Pendências: ${totalGeneral}`, margin, y + 16);

      doc.save(`relatorio_pendencias_fotos_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Erro ao gerar relatório com fotos.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAstecaPDF = () => {
    const doc = new jsPDF();
    
    // Filter issues to include only ASTECA topics
    let filteredIssues = agendaIssues.map(issue => {
        const normalized = issue.topics ? {
            ...issue,
            topics: issue.topics.map(t => ({ ...t, date: t.date || issue.date }))
        } : {
            ...issue,
            topics: [{
                id: generateUUID(),
                description: (issue as any).description || '',
                media: (issue as any).media || [],
                status: (issue as any).status || 'Pending',
                date: issue.date,
                isAsteca: (issue as any).isAsteca || false
            }]
        } as AgendaIssue;

        return {
            ...normalized,
            topics: normalized.topics.filter(t => {
                if (!t.isAsteca) return false;
                if (reportStatus === 'PENDING') return t.status === 'Pending';
                if (reportStatus === 'RESOLVED') return t.status === 'Resolved';
                return true;
            })
        };
    }).filter(i => i.topics.length > 0);

    if (startDate) filteredIssues = filteredIssues.filter(i => i.date >= startDate);
    if (endDate) filteredIssues = filteredIssues.filter(i => i.date <= endDate);
    if (reportClient) filteredIssues = filteredIssues.filter(i => i.clientName === reportClient);

    // Flatten and Group by Client
    const clientGroups: Record<string, any[]> = {};
    filteredIssues.forEach(issue => {
        if (!clientGroups[issue.clientName]) clientGroups[issue.clientName] = [];
        issue.topics.forEach(topic => {
            clientGroups[issue.clientName].push(topic);
        });
    });

    const sortedClients = Object.keys(clientGroups).sort();
    const totalClients = sortedClients.length;
    const totalAstecas = Object.values(clientGroups).reduce((sum, topics) => sum + topics.length, 0);

    // Header
    doc.setFontSize(18);
    doc.setTextColor(220, 38, 38); // Red-600
    doc.text(reportClient ? "Relatório de ASTECAS" : "Relatório Geral de ASTECAS", 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, 14, 28);
    
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text(reportClient ? "Resumo:" : "Resumo Geral:", 14, 38);
    doc.setFont("helvetica", "normal");
    
    let summaryY = 44;
    if (!reportClient) {
        doc.text(`Total de Clientes com ASTECAS: ${totalClients}`, 14, summaryY);
        summaryY += 6;
    }
    doc.text(`Total de ASTECAS: ${totalAstecas}`, 14, summaryY);

    let currentY = summaryY + 10;

    sortedClients.forEach((clientName) => {
        const topics = clientGroups[clientName].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        if (currentY > 250) {
            doc.addPage();
            currentY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text(`${clientName} (${topics.length} ASTECAS)`, 14, currentY);
        currentY += 5;

        const tableColumn = ["Data", "Dias", "Descrição", "Status"];
        const tableRows = topics.map(t => [
            new Date(t.date + 'T12:00:00Z').toLocaleDateString('pt-BR'),
            `${calculateDaysFromDate(t.date)}d`,
            t.description,
            t.status === 'Pending' ? 'Pendente' : 'Resolvido'
        ]);

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: currentY,
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [220, 38, 38] }, // Red-600
            alternateRowStyles: { fillColor: [254, 242, 242] }, // Red-50
            margin: { left: 14, right: 14 },
            didDrawPage: (data) => {
                currentY = data.cursor ? data.cursor.y : currentY;
            }
        });

        currentY = (doc as any).lastAutoTable.finalY + 15;
    });

    doc.save(`relatorio_geral_astecas_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div 
      className="flex flex-col h-full animate-fadeIn font-app max-w-5xl mx-auto font-normal overflow-hidden"
      style={{ overscrollBehavior: 'none' }}
    >
      {/* Fixed Header & Filters Container */}
      <div className="flex-none bg-slate-50/95 backdrop-blur-sm -mx-4 px-4 sm:mx-0 sm:px-0 pt-2 sm:pt-4 pb-4 space-y-4 shadow-sm border-b border-slate-200">
        {/* Header & Tabs */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <h2 className="text-lg sm:text-xl font-normal text-slate-800 uppercase tracking-tighter flex items-center gap-2">
              <BellIcon className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" /> Agenda de {user.username}
            </h2>
            <p className="text-[9px] sm:text-[10px] font-normal text-slate-400 uppercase tracking-widest">{viewMode === 'LIST' ? 'Lista Técnica de Pendências' : 'Compromissos Pessoais e Futuros'}</p>
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <div className="flex bg-slate-100 p-1 rounded-xl flex-grow sm:flex-grow-0">
              <button 
                onClick={() => setFilter('PENDING')}
                className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-[9px] sm:text-[10px] font-normal uppercase tracking-widest transition-all ${filter === 'PENDING' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
              >
                Pendentes
              </button>
              <button 
                onClick={() => setFilter('ASTECA')}
                className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-[9px] sm:text-[10px] font-normal uppercase tracking-widest transition-all ${filter === 'ASTECA' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}
              >
                ASTECAS
              </button>
              <button 
                onClick={() => setFilter('DONE')}
                className={`flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-lg text-[9px] sm:text-[10px] font-normal uppercase tracking-widest transition-all ${filter === 'DONE' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500'}`}
              >
                Concluídos
              </button>
            </div>
            <button 
              onClick={() => {
                  setEditingIssueId(null);
                  setIssueClient('');
                  setIssueDate(getLocalYYYYMMDD());
                  setFormTopics([{ id: generateUUID(), description: '', media: [], status: 'Pending', date: getLocalYYYYMMDD() }]);
                  setIsAdding(true);
              }}
              className="bg-blue-600 text-white p-2 sm:px-5 sm:py-2 rounded-xl font-normal text-[11px] uppercase tracking-widest shadow-md hover:bg-blue-700 transition-all active:scale-95 flex items-center justify-center gap-2"
              title="Novo Registro"
            >
              <PlusCircleIcon className="w-5 h-5 sm:w-4 sm:h-4" /> <span className="hidden sm:inline">Novo Registro</span>
            </button>
          </div>
        </div>

        {/* PDF Filters (Only for LIST view) */}
        {viewMode === 'LIST' && !isAdding && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-end gap-4 overflow-x-auto no-scrollbar">
                <div className="flex-shrink-0">
                    <label className="block text-[9px] font-normal text-slate-500 uppercase mb-1 tracking-wider">Data Início</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="flex-shrink-0">
                    <label className="block text-[9px] font-normal text-slate-500 uppercase mb-1 tracking-wider">Data Fim</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500" />
                </div>
                <div className="flex-shrink-0">
                    <label className="block text-[9px] font-normal text-slate-500 uppercase mb-1 tracking-wider">Status</label>
                    <select value={reportStatus} onChange={e => setReportStatus(e.target.value as any)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 min-w-[120px]">
                        <option value="ALL">Todos</option>
                        <option value="PENDING">Somente Pendentes</option>
                        <option value="RESOLVED">Somente Resolvidos</option>
                    </select>
                </div>
                <div className="flex-shrink-0">
                    <label className="block text-[9px] font-normal text-slate-500 uppercase mb-1 tracking-wider">Cliente</label>
                    <select value={reportClient} onChange={e => setReportClient(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none focus:border-blue-500 min-w-[150px] max-w-[200px]">
                        <option value="">Todos os Clientes</option>
                        {uniqueClients.map(client => (
                            <option key={client} value={client}>{client}</option>
                        ))}
                    </select>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button onClick={handleGeneratePDF} className="flex-1 sm:flex-none bg-slate-800 text-white px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest hover:bg-slate-700 flex items-center justify-center gap-2 h-[34px]">
                      <PrinterIcon className="w-4 h-4" /> <span className="sm:hidden">PDF</span><span className="hidden sm:inline">Gerar Relatório PDF</span>
                  </button>
                  <button 
                    onClick={handleGeneratePDFWithPhotos} 
                    disabled={isGenerating}
                    className="flex-1 sm:flex-none bg-blue-800 text-white px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest hover:bg-blue-700 flex items-center justify-center gap-2 h-[34px] disabled:opacity-50"
                  >
                      <PhotoIcon className="w-4 h-4" /> <span className="sm:hidden">Fotos</span><span className="hidden sm:inline">{isGenerating ? 'Gerando...' : 'Relatório com Fotos'}</span>
                  </button>
                  <button 
                    onClick={handleGenerateAstecaPDF} 
                    className="flex-1 sm:flex-none bg-red-600 text-white px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest hover:bg-red-700 flex items-center justify-center gap-2 h-[34px]"
                  >
                      <BellIcon className="w-4 h-4" /> <span className="sm:hidden">ASTECAS</span><span className="hidden sm:inline">Relatório ASTECAS</span>
                  </button>
                </div>
            </div>
          )}
        </div>
        {/* Scrollable Content Area */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto no-scrollbar px-0.5 pt-4 pb-20"
      >
        <div className="space-y-6">
          {/* Forms Section */}
          {/* isAdding modal moved to the end for better layering */}

      {/* List Content */}
      <div className="space-y-4">
        {viewMode === 'LIST' ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="overflow-visible">
                    <table className="w-full text-left font-normal border-collapse overflow-visible">
                        <thead className="sticky top-0 z-20 bg-slate-900 shadow-sm">
                            <tr className="text-white text-[9px] sm:text-[10px] uppercase tracking-widest font-normal">
                                <th className="p-3 sm:p-4 w-24 sm:w-32">Data</th>
                                <th className="p-3 sm:p-4">Cliente</th>
                                <th className="p-3 sm:p-4 w-16 sm:w-24 text-center">Dias</th>
                                <th className="p-3 sm:p-4 w-16 sm:w-24 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-[14px] md:text-[11px]">
                            {clientSummaries.length === 0 ? (
                                <tr><td colSpan={4} className="p-20 text-center text-slate-400 italic">Nenhuma pendência na lista.</td></tr>
                            ) : (
                                clientSummaries.map(summary => (
                                    <React.Fragment key={summary.name}>
                                        <tr 
                                            id={`client-row-${summary.name}`}
                                            onClick={() => setViewingClientName(summary.name)}
                                            className="cursor-pointer hover:bg-slate-50 transition-colors bg-white"
                                        >
                                            <td className="p-4 text-slate-500 font-medium">
                                                {new Date(summary.oldestDate + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                                            </td>
                                            <td className="p-4 font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
                                                {summary.name}
                                                <span className="bg-blue-100 text-blue-600 text-[9px] px-1.5 py-0.5 rounded-full">
                                                    {summary.totalTopics}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`px-2 py-1 rounded-full font-bold text-[10px] ${summary.daysOpen > 10 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'}`}>
                                                    {summary.daysOpen}d
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <ChevronRightIcon className="w-5 h-5 text-slate-300 transition-transform inline-block" />
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        ) : (
            <div className="space-y-4">
                {sortedReminders.length === 0 ? (
                <div className="py-24 text-center bg-white rounded-3xl border-2 border-dashed border-slate-100">
                    <CalendarDaysIcon className="w-16 h-16 text-slate-100 mx-auto mb-4" />
                    <p className="text-slate-400 font-normal text-xs uppercase tracking-[0.2em]">Sua agenda pessoal está vazia</p>
                </div>
                ) : (
                sortedReminders.map(item => {
                    const daysOpen = calculateDaysOpen(item.createdAt);
                    const isLate = item.status === 'Pending' && new Date(item.dueDate) < new Date();
                    
                    return (
                    <div key={item.id} className={`group bg-white p-6 rounded-2xl border transition-all duration-300 relative overflow-hidden ${isLate ? 'border-red-200 shadow-red-50' : 'border-slate-100'} ${item.status === 'Done' ? 'opacity-60 grayscale' : 'hover:shadow-md hover:border-blue-100'}`}>
                        {isLate && <div className="absolute top-0 left-0 w-1.5 h-full bg-red-500 animate-pulse" />}
                        
                        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="flex-grow min-w-0 font-normal">
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <h3 className={`font-normal uppercase tracking-tight text-sm sm:text-base ${item.status === 'Done' ? 'line-through text-green-600' : 'text-slate-800'}`}>
                                                                {item.title}
                                                            </h3>
                            {isLate && <span className="bg-red-500 text-white text-[8px] font-normal px-2 py-0.5 rounded-full uppercase">Urgente</span>}
                            </div>
                            <p className="text-xs text-slate-500 font-normal leading-relaxed mb-4">{item.description}</p>
                            
                            <div className="flex flex-wrap gap-x-6 gap-y-2">
                            <div className="flex items-center gap-2 font-normal">
                                <CalendarDaysIcon className="w-4 h-4 text-blue-400" />
                                <span className="text-[10px] font-normal text-slate-400 uppercase tracking-wide">
                                Agendado: <span className="text-blue-600">{new Date(item.dueDate).toLocaleString('pt-BR')}</span>
                                </span>
                            </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                            <button 
                            onClick={() => toggleStatus(item.id)}
                            className={`p-3 rounded-full transition-all ${item.status === 'Done' ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400 hover:text-green-600 hover:bg-green-50 shadow-sm'}`}
                            >
                            <CheckCircleIcon className="w-6 h-6" />
                            </button>
                            <button 
                            onClick={() => deleteItem(item.id)}
                            className="p-3 rounded-full bg-slate-50 text-slate-300 hover:text-red-600"
                            >
                            <TrashIcon className="w-6 h-6" />
                            </button>
                        </div>
                        </div>
                    </div>
                    );
                })
                )}
            </div>
        )}
      </div>
    </div>
  </div>


      {/* Media Viewer Modal */}
      {editingTopic && (
        <Modal onClose={() => setEditingTopic(null)}>
          <div className="animate-fadeIn">
            <h3 className="font-normal text-slate-800 uppercase text-sm tracking-widest mb-6 pr-8 sm:pr-0">Editar Item da Pendência</h3>
            <form onSubmit={handleSaveSingleTopic} className="space-y-5">
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex flex-col gap-3">
                    <div className="relative flex-grow">
                      <label className="block text-[10px] font-normal text-slate-500 uppercase mb-1.5 tracking-wider">Descrição</label>
                      <textarea 
                        required 
                        value={editingTopic.topic.description} 
                        onChange={e => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, description: e.target.value } })}
                        className="w-full p-3 pr-10 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm h-32 resize-none bg-white transition-all" 
                        placeholder="Descreva o item da pendência..." 
                      />
                      <button
                        type="button"
                        onClick={() => handleProfessionalizeText(editingTopic.topic.description, 'topic', editingTopic.topic.id)}
                        disabled={isProfessionalizing === editingTopic.topic.id}
                        className={`absolute right-2 bottom-2 p-1.5 rounded-lg transition-all ${
                          isProfessionalizing === editingTopic.topic.id 
                          ? 'bg-slate-100 text-slate-400' 
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                        }`}
                        title="Melhorar com IA"
                      >
                        <SparklesIcon className={`w-4 h-4 ${isProfessionalizing === editingTopic.topic.id ? 'animate-pulse' : ''}`} />
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-normal text-slate-500 uppercase mb-1 tracking-wider">Data do Item</label>
                        <input 
                          type="date" 
                          required 
                          value={editingTopic.topic.date} 
                          onChange={e => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, date: e.target.value } })}
                          className="w-full p-2 border-2 border-slate-100 rounded-lg focus:border-blue-500 outline-none font-normal text-xs bg-white transition-all" 
                        />
                      </div>
                      <div className="flex items-center">
                        <label className="flex items-center gap-2 cursor-pointer group mt-4">
                          <input 
                            type="checkbox" 
                            checked={!!editingTopic.topic.isAsteca} 
                            onChange={e => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, isAsteca: e.target.checked } })}
                            className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                          />
                          <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${editingTopic.topic.isAsteca ? 'text-red-600' : 'text-slate-400 group-hover:text-slate-600'}`}>ASTECA</span>
                        </label>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    {editingTopic.topic.media.map(m => (
                      <div key={m.id} className="relative w-20 h-20 group">
                        <img src={getDisplayableDriveUrl(m.url) || undefined} className="w-full h-full object-cover rounded-lg border border-slate-200" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1">
                          <button 
                            type="button" 
                            onClick={() => setEditingMedia({ media: m, topicId: editingTopic.topic.id })}
                            className="bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-blue-600 shadow-lg"
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          <button 
                            type="button" 
                            onClick={() => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, media: editingTopic.topic.media.filter(x => x.id !== m.id) } })} 
                            className="bg-red-500 text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-red-600 shadow-lg"
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    ))}
                    <label className={`w-20 h-20 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-colors ${uploadingTopicId === editingTopic.topic.id ? 'opacity-50' : ''}`}>
                      <CameraIcon className="w-6 h-6 text-slate-400" />
                      <span className="text-[8px] font-normal text-slate-400 uppercase mt-1">Anexar</span>
                      <input type="file" className="hidden" accept="image/*" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingTopicId(editingTopic.topic.id);
                        const tempId = generateUUID();
                        const localUrl = URL.createObjectURL(file);
                        const tempMedia: Media = { id: tempId, type: 'image', url: localUrl, name: file.name };
                        setEditingTopic(prev => prev ? { ...prev, topic: { ...prev.topic, media: [...prev.topic.media, tempMedia] } } : null);
                        try {
                          const { base64: base64Data, mimeType } = await compressImage(file);
                          const response = await fetchWithRetry(SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({ action: 'UPLOAD_FILE', data: { base64Data, fileName: file.name, mimeType: mimeType } }),
                          });
                          const result = await response.json();
                          if (!result.success || !result.url) throw new Error(result.message || 'Falha no upload');
                          setEditingTopic(prev => prev ? { ...prev, topic: { ...prev.topic, media: prev.topic.media.map(m => m.id === tempId ? { ...m, url: result.url, originalUrl: result.url } : m) } } : null);
                        } catch (error: any) {
                          alert(`Erro no upload: ${error.message}`);
                          setEditingTopic(prev => prev ? { ...prev, topic: { ...prev.topic, media: prev.topic.media.filter(m => m.id !== tempId) } } : null);
                        } finally {
                          setUploadingTopicId(null);
                        }
                      }} disabled={!!uploadingTopicId} />
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setEditingTopic(null)} className="px-6 py-2 text-slate-400 font-normal text-[10px] uppercase tracking-widest">Cancelar</button>
                <button type="submit" className="px-8 py-3 bg-blue-600 text-white rounded-xl font-normal text-[11px] uppercase tracking-widest shadow-lg hover:bg-blue-700">
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Client Items Modal */}
      {viewingClientItems && (
        <Modal onClose={() => setViewingClientName(null)} noScroll={true}>
          <div className="flex flex-col h-[80vh] overflow-hidden">
            <div className="flex justify-between items-center p-4 sm:p-6 pb-4 pr-10 sm:pr-6 flex-shrink-0">
              <h3 className="font-normal text-slate-800 uppercase text-sm tracking-widest">
                Pendências: <span className="font-bold">{viewingClientItems.name}</span>
              </h3>
            </div>

            <div className="mx-4 sm:mx-6 mb-4 sm:mb-6 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative">
              {/* Fixed Header within Modal */}
              <div className="bg-slate-900 shadow-md z-50 flex-shrink-0 relative">
                <div className="flex text-white text-[9px] sm:text-[10px] uppercase tracking-widest font-normal">
                  <div className="p-3 sm:p-4 w-24 sm:w-32">Data</div>
                  <div className="p-3 sm:p-4 flex-1">Cliente</div>
                  <div className="p-3 sm:p-4 w-16 sm:w-24 text-center">Dias</div>
                  <div className="p-3 sm:p-4 w-16 sm:w-24 text-right">Ações</div>
                </div>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto scrollbar-custom bg-slate-50/50 min-h-0 z-10">
                <div className="p-4 space-y-4">
                  {viewingClientItems.issues.map((issue) => (
                    <div key={issue.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                      <div className="bg-slate-100 px-4 py-2 flex justify-between items-center sticky top-0 z-20 shadow-sm border-b border-slate-200">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">
                          Lançamento: {new Date(issue.date + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                        </span>
                        <div className="flex gap-3">
                          <button 
                            onClick={() => {
                              handleEditIssue(issue);
                              setFormTopics(prev => [...prev, { id: generateUUID(), description: '', media: [], status: 'Pending', date: getLocalYYYYMMDD(), isAsteca: false }]);
                            }} 
                            className="flex items-center gap-1 text-green-600 hover:text-green-800 text-[10px] sm:text-[11px] font-bold uppercase tracking-tight"
                          >
                            <PlusCircleIcon className="w-3 h-3" /> Adicionar
                          </button>
                          <button onClick={() => handleEditIssue(issue)} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-[10px] sm:text-[11px] font-bold uppercase tracking-tight">
                            <PencilIcon className="w-3 h-3" /> Editar
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Deseja realmente excluir esta pendência e todos os seus tópicos?')) {
                                deleteIssue(issue.id);
                              }
                            }} 
                            className="flex items-center gap-1 text-red-600 hover:text-red-800 text-[10px] sm:text-[11px] font-bold uppercase tracking-tight"
                          >
                            <TrashIcon className="w-3 h-3" /> Excluir
                          </button>
                        </div>
                      </div>
                      <div className="divide-y divide-slate-50">
                        {issue.topics.map((topic, idx) => {
                      const topicDays = calculateDaysFromDate(topic.date || issue.date);
                      return (
                        <div 
                          key={topic.id} 
                          onClick={() => setViewingTopicDetail({ issueId: issue.id, topic })}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-50 last:border-0"
                        >
                          <div className="flex items-start gap-4 min-w-0">
                            <span className="text-slate-400 font-bold text-sm mt-0.5">{idx + 1}.</span>
                            <div className="flex flex-col gap-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <input 
                                  type="checkbox" 
                                  checked={topic.status === 'Resolved'} 
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    toggleTopicStatus(issue.id, topic.id);
                                  }}
                                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                                <span className="text-[10px] font-bold text-slate-400 uppercase">
                                  {new Date((topic.date || issue.date) + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                                </span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${topicDays > 10 ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500'}`}>
                                  {topicDays} dias
                                </span>
                                {topic.isAsteca && (
                                  <span className="bg-red-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">ASTECA</span>
                                )}
                              </div>
                              <p className={`text-sm leading-relaxed ${topic.status === 'Resolved' ? 'line-through text-green-600' : (topic.isAsteca ? 'text-red-600 font-bold' : 'text-slate-700')}`}>
                                {topic.description}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-center mt-2 sm:mt-0">
                            {topic.media.length > 0 && (
                              <div className="flex -space-x-2 overflow-hidden">
                                {topic.media.slice(0, 3).map((m, i) => (
                                  <img 
                                    key={m.id} 
                                    src={getDisplayableDriveUrl(m.url) || undefined} 
                                    className="inline-block h-8 w-8 rounded-full ring-2 ring-white object-cover" 
                                    alt="" 
                                  />
                                ))}
                                {topic.media.length > 3 && (
                                  <span className="flex items-center justify-center h-8 w-8 rounded-full ring-2 ring-white bg-slate-100 text-[10px] font-bold text-slate-500">
                                    +{topic.media.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                            <ChevronRightIcon className="w-5 h-5 text-slate-300" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )}

      {/* Topic Detail Modal */}
      {viewingTopicDetail && (
        <Modal onClose={() => setViewingTopicDetail(null)}>
          <div className="animate-fadeIn space-y-6">
            <div className="flex justify-between items-start pr-8 sm:pr-0">
              <div>
                <h3 className="font-bold text-slate-800 uppercase text-sm tracking-widest mb-1">Detalhes da Pendência</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    {new Date(viewingTopicDetail.topic.date + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                  </span>
                  {viewingTopicDetail.topic.isAsteca && (
                    <span className="bg-red-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">ASTECA</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    handleEditTopic(viewingTopicDetail.issueId, viewingTopicDetail.topic);
                    setViewingTopicDetail(null);
                  }}
                  className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                  title="Editar"
                >
                  <PencilIcon className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => {
                    if (confirm('Deseja realmente excluir este item da pendência?')) {
                      handleDeleteTopic(viewingTopicDetail.issueId, viewingTopicDetail.topic.id);
                      setViewingTopicDetail(null);
                    }
                  }}
                  className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors"
                  title="Excluir"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <p className={`text-base leading-relaxed whitespace-pre-wrap ${viewingTopicDetail.topic.status === 'Resolved' ? 'line-through text-green-600' : (viewingTopicDetail.topic.isAsteca ? 'text-red-600 font-bold' : 'text-slate-700')}`}>
                {viewingTopicDetail.topic.description}
              </p>
            </div>

            {viewingTopicDetail.topic.media.length > 0 && (
              <div className="space-y-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fotos Anexadas ({viewingTopicDetail.topic.media.length})</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {viewingTopicDetail.topic.media.map((m, idx) => (
                    <div 
                      key={m.id} 
                      className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => {
                        const issue = agendaIssues.find(i => i.id === viewingTopicDetail.issueId);
                        setViewingMedia({ list: viewingTopicDetail.topic.media, index: idx, topicId: viewingTopicDetail.topic.id, issue });
                      }}
                    >
                      <img src={getDisplayableDriveUrl(m.url) || undefined} className="w-full h-full object-cover" alt="" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button 
                onClick={() => toggleTopicStatus(viewingTopicDetail.issueId, viewingTopicDetail.topic.id)}
                className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-[11px] uppercase tracking-widest shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 ${
                  viewingTopicDetail.topic.status === 'Resolved' 
                  ? 'bg-slate-100 text-slate-500' 
                  : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {viewingTopicDetail.topic.status === 'Resolved' ? (
                  <><RefreshIcon className="w-4 h-4" /> Reabrir Pendência</>
                ) : (
                  <><CheckCircleIcon className="w-4 h-4" /> Marcar como Concluído</>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Media Viewer Modal */}
      {viewingMedia && (
          <Modal onClose={() => setViewingMedia(null)} fullScreen={true}>
              <div className="w-full h-full flex flex-col items-center justify-center relative touch-none bg-black/95">
                <div className="flex-grow w-full h-full flex items-center justify-center overflow-hidden">
                    <img 
                        src={getDisplayableDriveUrl(viewingMedia.list[viewingMedia.index].url) || undefined} 
                        className="max-h-full max-w-full object-contain"
                    />
                </div>
                
                <div className="absolute top-4 right-16 flex items-center gap-2">
                    {viewingMedia.topicId && viewingMedia.issue && (
                        <button 
                            onClick={() => {
                                const currentMedia = viewingMedia.list[viewingMedia.index];
                                const currentTopicId = viewingMedia.topicId!;
                                const currentIssue = viewingMedia.issue!;
                                
                                // Prepare for editing
                                handleEditIssue(currentIssue);
                                setEditingMedia({ media: currentMedia, topicId: currentTopicId });
                                setViewingMedia(null);
                            }}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg"
                        >
                            <PencilIcon className="w-4 h-4" /> Editar Foto
                        </button>
                    )}
                </div>

                {viewingMedia.list.length > 1 && (
                    <>
                        <button className="absolute left-4 top-1/2 -translate-y-1/2 p-4 bg-white/10 rounded-full text-white" onClick={() => setViewingMedia(prev => prev ? { ...prev, index: (prev.index - 1 + prev.list.length) % prev.list.length } : null)}><ChevronLeftIcon className="w-8 h-8"/></button>
                        <button className="absolute right-4 top-1/2 -translate-y-1/2 p-4 bg-white/10 rounded-full text-white" onClick={() => setViewingMedia(prev => prev ? { ...prev, index: (prev.index + 1) % prev.list.length } : null)}><ChevronRightIcon className="w-8 h-8"/></button>
                    </>
                )}
              </div>
          </Modal>
      )}

      {/* Edit Photo Modal */}
      {editingMedia && (
        <PhotoEditor 
          media={editingMedia.media}
          onClose={() => setEditingMedia(null)}
          onSave={async (updatedMedia) => {
            let finalMedia = updatedMedia;
            
            // If the URL is a data URL (edited image), upload it to Drive to ensure persistence
            if (updatedMedia.url.startsWith('data:')) {
              try {
                setUploadingTopicId(editingMedia.topicId);
                const base64Data = updatedMedia.url;
                const response = await fetchWithRetry(SCRIPT_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                  body: JSON.stringify({ 
                    action: 'UPLOAD_FILE', 
                    data: { 
                      base64Data, 
                      fileName: `edited_${updatedMedia.name || 'photo.jpg'}`, 
                      mimeType: 'image/jpeg' 
                    } 
                  }),
                });
                const result = await response.json();
                if (result.success && result.url) {
                  finalMedia = { ...updatedMedia, url: result.url };
                }
              } catch (error) {
                console.error("Erro ao salvar foto editada na nuvem:", error);
                alert("A foto foi editada localmente, mas houve um erro ao salvar na nuvem. Ela pode não persistir ao recarregar.");
              } finally {
                setUploadingTopicId(null);
              }
            }

            const updatedTopics = formTopics.map(t => 
              t.id === editingMedia.topicId 
                ? { ...t, media: t.media.map(m => m.id === finalMedia.id ? finalMedia : m) }
                : t
            );

            setFormTopics(updatedTopics);

            // Se estiver editando uma pendência já existente, salva imediatamente no banco
            if (editingIssueId) {
                const updatedIssues = agendaIssues.map(issue => 
                    issue.id === editingIssueId 
                    ? { ...issue, topics: updatedTopics, clientName: issueClient.trim(), date: issueDate }
                    : issue
                );
                onUpdateAgendaIssues(updatedIssues);
            }

            setEditingMedia(null);
          }}
        />
      )}

      {/* Edit Topic Modal */}
      {editingTopic && (
        <Modal onClose={() => setEditingTopic(null)}>
          <div className="animate-fadeIn">
            <h3 className="font-normal text-slate-800 uppercase text-sm tracking-widest mb-6 pr-8 sm:pr-0">Editar Item da Pendência</h3>
            <form onSubmit={handleSaveSingleTopic} className="space-y-5">
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex flex-col gap-3">
                    <div className="relative flex-grow">
                      <label className="block text-[10px] font-normal text-slate-500 uppercase mb-1.5 tracking-wider">Descrição</label>
                      <textarea 
                        required 
                        value={editingTopic.topic.description} 
                        onChange={e => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, description: e.target.value } })}
                        className="w-full p-3 pr-10 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm h-32 resize-none bg-white transition-all" 
                        placeholder="Descreva o item da pendência..." 
                      />
                      <button
                        type="button"
                        onClick={() => handleProfessionalizeText(editingTopic.topic.description, 'topic', editingTopic.topic.id)}
                        disabled={isProfessionalizing === editingTopic.topic.id}
                        className={`absolute right-2 bottom-2 p-1.5 rounded-lg transition-all ${
                          isProfessionalizing === editingTopic.topic.id 
                          ? 'bg-slate-100 text-slate-400' 
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                        }`}
                        title="Melhorar com IA"
                      >
                        <SparklesIcon className={`w-4 h-4 ${isProfessionalizing === editingTopic.topic.id ? 'animate-pulse' : ''}`} />
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-normal text-slate-500 uppercase mb-1 tracking-wider">Data do Item</label>
                        <input 
                          type="date" 
                          required 
                          value={editingTopic.topic.date} 
                          onChange={e => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, date: e.target.value } })}
                          className="w-full p-2 border-2 border-slate-100 rounded-lg focus:border-blue-500 outline-none font-normal text-xs bg-white transition-all" 
                        />
                      </div>
                      <div className="flex items-center">
                        <label className="flex items-center gap-2 cursor-pointer group mt-4">
                          <input 
                            type="checkbox" 
                            checked={!!editingTopic.topic.isAsteca} 
                            onChange={e => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, isAsteca: e.target.checked } })}
                            className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                          />
                          <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${editingTopic.topic.isAsteca ? 'text-red-600' : 'text-slate-400 group-hover:text-slate-600'}`}>ASTECA</span>
                        </label>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    {editingTopic.topic.media.map(m => (
                      <div key={m.id} className="relative w-20 h-20 group">
                        <img src={getDisplayableDriveUrl(m.url) || undefined} className="w-full h-full object-cover rounded-lg border border-slate-200" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1">
                          <button 
                            type="button" 
                            onClick={() => setEditingMedia({ media: m, topicId: editingTopic.topic.id })}
                            className="bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-blue-600 shadow-lg"
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          <button 
                            type="button" 
                            onClick={() => setEditingTopic({ ...editingTopic, topic: { ...editingTopic.topic, media: editingTopic.topic.media.filter(x => x.id !== m.id) } })} 
                            className="bg-red-500 text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-red-600 shadow-lg"
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    ))}
                    <label className={`w-20 h-20 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-colors ${uploadingTopicId === editingTopic.topic.id ? 'opacity-50' : ''}`}>
                      <CameraIcon className="w-6 h-6 text-slate-400" />
                      <span className="text-[8px] font-normal text-slate-400 uppercase mt-1">Anexar</span>
                      <input type="file" className="hidden" accept="image/*" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingTopicId(editingTopic.topic.id);
                        const tempId = generateUUID();
                        const localUrl = URL.createObjectURL(file);
                        const tempMedia: Media = { id: tempId, type: 'image', url: localUrl, name: file.name };
                        setEditingTopic(prev => prev ? { ...prev, topic: { ...prev.topic, media: [...prev.topic.media, tempMedia] } } : null);
                        try {
                          const { base64: base64Data, mimeType } = await compressImage(file);
                          const response = await fetchWithRetry(SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({ action: 'UPLOAD_FILE', data: { base64Data, fileName: file.name, mimeType: mimeType } }),
                          });
                          const result = await response.json();
                          if (!result.success || !result.url) throw new Error(result.message || 'Falha no upload');
                          setEditingTopic(prev => prev ? { ...prev, topic: { ...prev.topic, media: prev.topic.media.map(m => m.id === tempId ? { ...m, url: result.url, originalUrl: result.url } : m) } } : null);
                        } catch (error: any) {
                          alert(`Erro no upload: ${error.message}`);
                          setEditingTopic(prev => prev ? { ...prev, topic: { ...prev.topic, media: prev.topic.media.filter(m => m.id !== tempId) } } : null);
                        } finally {
                          setUploadingTopicId(null);
                        }
                      }} disabled={!!uploadingTopicId} />
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setEditingTopic(null)} className="px-6 py-2 text-slate-400 font-normal text-[10px] uppercase tracking-widest">Cancelar</button>
                <button type="submit" className="px-8 py-3 bg-blue-600 text-white rounded-xl font-normal text-[11px] uppercase tracking-widest shadow-lg hover:bg-blue-700">
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Add/Edit Modal - Moved to the end for top-most layering */}
      {isAdding && (
        <Modal onClose={() => setIsAdding(false)}>
          <div className="animate-fadeIn">
            <div className="flex justify-between items-center mb-6 pr-8 sm:pr-0">
              <h3 className="font-normal text-slate-800 uppercase text-sm tracking-widest">
                  {viewMode === 'LIST' ? (editingIssueId ? 'Editar Pendência' : 'Registrar Pendência na Lista') : 'Novo Registro na Sua Agenda'}
              </h3>
              {aiError && (
                <div className="bg-red-50 text-red-600 text-[10px] px-3 py-1 rounded-full animate-bounce">
                  {aiError}
                </div>
              )}
            </div>
          
          {viewMode === 'LIST' ? (
              <form onSubmit={handleAddIssue} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                        <label className="block text-[10px] font-normal text-slate-500 uppercase mb-1.5 tracking-wider">Nome do Cliente</label>
                        <input required value={issueClient} onChange={e => setIssueClient(e.target.value)} className="w-full p-3 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm bg-slate-50 focus:bg-white transition-all" placeholder="Ex: João da Silva..." />
                    </div>
                    <div>
                        <label className="block text-[10px] font-normal text-slate-500 uppercase mb-1.5 tracking-wider">Data da Pendência</label>
                        <input required type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="w-full p-3 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm bg-slate-50 focus:bg-white transition-all" />
                    </div>
                    
                    <div className="md:col-span-2 space-y-4">
                        <div className="flex justify-between items-center">
                            <label className="block text-[10px] font-normal text-slate-500 uppercase tracking-wider">Tópicos da Pendência</label>
                        </div>
                        
                        <div className="space-y-4">
                            {formTopics.map((topic, index) => (
                                <div key={topic.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 relative">
                                    {formTopics.length > 1 && (
                                        <button 
                                            type="button" 
                                            onClick={() => setFormTopics(formTopics.filter(t => t.id !== topic.id))}
                                            className="absolute top-2 right-2 text-slate-400 hover:text-red-500"
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    )}
                                    <div className="flex flex-col sm:flex-row gap-3">
                                        <div className="flex gap-3 flex-grow">
                                            <span className="text-slate-400 font-bold text-sm mt-2">{index + 1}.</span>
                                            <div className="relative flex-grow">
                                                <textarea 
                                                    required 
                                                    value={topic.description} 
                                                    onChange={e => setFormTopics(formTopics.map(t => t.id === topic.id ? { ...t, description: e.target.value } : t))}
                                                    className="w-full p-3 pr-10 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm h-20 resize-none bg-white transition-all" 
                                                    placeholder="Descreva o item da pendência..." 
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleProfessionalizeText(topic.description, 'topic', topic.id)}
                                                    disabled={isProfessionalizing === topic.id}
                                                    className={`absolute right-2 bottom-2 p-1.5 rounded-lg transition-all ${
                                                        isProfessionalizing === topic.id 
                                                        ? 'bg-slate-100 text-slate-400' 
                                                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                                    }`}
                                                    title="Melhorar com IA"
                                                >
                                                    <SparklesIcon className={`w-4 h-4 ${isProfessionalizing === topic.id ? 'animate-pulse' : ''}`} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="sm:w-40 space-y-2">
                                            <div>
                                                <label className="block text-[9px] font-normal text-slate-500 uppercase mb-1 tracking-wider">Data do Item</label>
                                                <input 
                                                    type="date" 
                                                    required 
                                                    value={topic.date} 
                                                    onChange={e => setFormTopics(formTopics.map(t => t.id === topic.id ? { ...t, date: e.target.value } : t))}
                                                    className="w-full p-2 border-2 border-slate-100 rounded-lg focus:border-blue-500 outline-none font-normal text-xs bg-white transition-all" 
                                                />
                                            </div>
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <input 
                                                    type="checkbox" 
                                                    checked={!!topic.isAsteca} 
                                                    onChange={e => setFormTopics(formTopics.map(t => t.id === topic.id ? { ...t, isAsteca: e.target.checked } : t))}
                                                    className="w-4 h-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                                                />
                                                <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${topic.isAsteca ? 'text-red-600' : 'text-slate-400 group-hover:text-slate-600'}`}>ASTECA</span>
                                            </label>
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-wrap gap-2 pl-7">
                                        {topic.media.map(m => (
                                            <div key={m.id} className="relative w-16 h-16 group">
                                                <img src={getDisplayableDriveUrl(m.url) || undefined} className="w-full h-full object-cover rounded-lg border border-slate-200" referrerPolicy="no-referrer" />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1">
                                                    <button 
                                                        type="button" 
                                                        onClick={() => setEditingMedia({ media: m, topicId: topic.id })}
                                                        className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-blue-600 shadow-lg"
                                                        title="Editar Foto"
                                                    >
                                                        <PencilIcon className="w-3 h-3" />
                                                    </button>
                                                    <button 
                                                        type="button" 
                                                        onClick={() => setFormTopics(formTopics.map(t => t.id === topic.id ? { ...t, media: t.media.filter(x => x.id !== m.id) } : t))} 
                                                        className="bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 shadow-lg"
                                                        title="Excluir"
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        <label className={`w-16 h-16 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-white transition-colors ${uploadingTopicId === topic.id ? 'opacity-50' : ''}`}>
                                            <CameraIcon className="w-5 h-5 text-slate-400" />
                                            <span className="text-[7px] font-normal text-slate-400 uppercase mt-1">Anexar</span>
                                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileChange(e, topic.id)} disabled={!!uploadingTopicId} />
                                        </label>
                                    </div>
                                </div>
                            ))}

                            <button 
                                type="button" 
                                onClick={() => setFormTopics([...formTopics, { id: generateUUID(), description: '', media: [], status: 'Pending', date: getLocalYYYYMMDD() }])}
                                className="w-full py-3 border-2 border-dashed border-blue-200 rounded-xl text-blue-600 font-bold uppercase text-[10px] hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                            >
                                <PlusCircleIcon className="w-4 h-4" /> Adicionar Tópico
                            </button>
                        </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setIsAdding(false)} className="px-6 py-2 text-slate-400 font-normal text-[10px] uppercase tracking-widest">Cancelar</button>
                    <button type="submit" className="px-6 sm:px-10 py-3 bg-blue-600 text-white rounded-xl font-normal text-[11px] uppercase tracking-widest shadow-lg hover:bg-blue-700">
                        {editingIssueId ? 'Atualizar Pendência' : 'Salvar Pendência na Lista'}
                    </button>
                  </div>
              </form>
          ) : (
              <form onSubmit={handleAddReminder} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-normal text-slate-500 uppercase mb-1.5 tracking-wider">O que você precisa lembrar?</label>
                    <input required value={title} onChange={e => setTitle(e.target.value)} className="w-full p-3 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm bg-slate-50 focus:bg-white transition-all" placeholder="Título do compromisso..." />
                  </div>
                  <div>
                    <label className="block text-[10px] font-normal text-slate-500 uppercase mb-1.5 tracking-wider">Data e Hora do Lembrete</label>
                    <input required type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full p-3 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm bg-slate-50 focus:bg-white transition-all" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-normal text-slate-500 uppercase mb-1.5 tracking-wider">Descrição Detalhada (Opcional)</label>
                    <div className="relative">
                        <textarea 
                            value={description} 
                            onChange={e => setDescription(e.target.value)} 
                            className="w-full p-3 pr-10 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none font-normal text-sm h-28 resize-none bg-slate-50 focus:bg-white transition-all" 
                            placeholder="Mais detalhes sobre esta tarefa..." 
                        />
                        <button
                            type="button"
                            onClick={() => handleProfessionalizeText(description, 'reminder')}
                            disabled={isProfessionalizing === 'reminder'}
                            className={`absolute right-2 bottom-2 p-1.5 rounded-lg transition-all ${
                                isProfessionalizing === 'reminder' 
                                ? 'bg-slate-100 text-slate-400' 
                                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                            }`}
                            title="Melhorar com IA"
                        >
                            <SparklesIcon className={`w-4 h-4 ${isProfessionalizing === 'reminder' ? 'animate-pulse' : ''}`} />
                        </button>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setIsAdding(false)} className="px-6 py-2 text-slate-400 font-normal text-[10px] uppercase tracking-widest">Cancelar</button>
                  <button type="submit" className="px-6 sm:px-10 py-3 bg-blue-600 text-white rounded-xl font-normal text-[11px] uppercase tracking-widest shadow-lg hover:bg-blue-700">Salvar Lembrete</button>
                </div>
              </form>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PersonalAgenda;
