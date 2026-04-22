
import React, { useState, useRef, useMemo } from 'react';
import { FurnitureOrder, FurnitureOrderItem, Assembler, Client, Media } from '../types';
import { generateUUID, SCRIPT_URL } from '../App';
import { fetchWithRetry, safeJSONFetch } from '../utils/api';
import Modal from './Modal';
import { jsPDF } from 'jspdf';
import { 
    PlusCircleIcon, 
    ShoppingCartIcon, 
    TrashIcon, 
    CameraIcon, 
    RefreshIcon, 
    ChevronRightIcon, 
    SearchIcon,
    XIcon,
    PencilIcon,
    CalendarIcon,
    ClockIcon,
    CheckCircleIcon,
    PrinterIcon,
    ClipboardListIcon,
    TagIcon
} from './icons';

interface FurnitureOrderManagerProps {
    orders: FurnitureOrder[];
    assemblers: Assembler[];
    clients: Client[];
    onUpdateOrders: (orders: FurnitureOrder[]) => void;
}

const getDisplayableDriveUrl = (url: string): string | undefined => {
    if (!url) return undefined;
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const driveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/;
    const match = url.match(driveRegex);
    if (match && match[1]) return `https://lh3.googleusercontent.com/d/${match[1]}`;
    return url;
};

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
            const MAX_SIZE = 1000;
            if (width > height) {
                if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
            } else {
                if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.5);
            resolve({ base64: compressedBase64, mimeType: 'image/jpeg' });
        };
        reader.readAsDataURL(file);
    });
};

const FurnitureOrderManager: React.FC<FurnitureOrderManagerProps> = ({ orders, assemblers, clients, onUpdateOrders }) => {
    const [isCreating, setIsCreating] = useState(false);
    const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
    const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
    const [viewingMedia, setViewingMedia] = useState<{ list: Media[], index: number } | null>(null);
    const [showManifest, setShowManifest] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const [activeTab, setActiveTab] = useState<'OPEN' | 'COMPLETED'>('OPEN');

    
    // Selection State
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

    // Form State
    const [clientName, setClientName] = useState('');
    const [assemblerName, setAssemblerName] = useState('');
    const [orderDate, setOrderDate] = useState(new Date().toLocaleDateString('en-CA'));
    const [items, setItems] = useState<FurnitureOrderItem[]>([]);
    
    // New Item State
    const [newQty, setNewQty] = useState('');
    const [newUnit, setNewUnit] = useState('un');
    const [newDesc, setNewDesc] = useState('');
    const [newMedia, setNewMedia] = useState<Media | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const calculateDaysElapsed = (createdAt: string) => {
        const start = new Date(createdAt);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - start.getTime());
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    };

    const filteredOrders = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return orders.filter(o => 
            o.clientName.toLowerCase().includes(term) || 
            o.assemblerName.toLowerCase().includes(term) ||
            (o.generatedOrderDate || '').toLowerCase().includes(term)
        ).sort((a, b) => {
            if (a.status === b.status) {
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
            return a.status === 'Pending' ? -1 : 1;
        });
    }, [orders, searchTerm]);

    const activeGeneratedOrders = useMemo(() => {
        const orderGroups = new Map<string, { id: string, date: string }>();
        orders.forEach(o => { 
            if(o.generatedOrderId && o.generatedOrderDate) {
                orderGroups.set(o.generatedOrderId, { id: o.generatedOrderId, date: o.generatedOrderDate });
            }
        });
        return Array.from(orderGroups.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [orders]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const { base64: base64Data, mimeType } = await compressImage(file);
            const response = await fetchWithRetry(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'UPLOAD_FILE', data: { base64Data, fileName: `order_${Date.now()}.jpg`, mimeType: mimeType } }),
            });
            const result = await safeJSONFetch(response);
            if (result && result.success) {
                setNewMedia({ id: generateUUID(), type: 'image', url: result.url, name: file.name });
            }
        } catch (err) { 
            alert("Erro no upload"); 
        } finally { 
            setUploading(false); 
        }
    };

    const addItem = () => {
        if (!newDesc || !newQty) return;
        const item: FurnitureOrderItem = {
            id: generateUUID(),
            quantity: Number(newQty),
            unit: newUnit,
            description: newDesc,
            media: newMedia || undefined
        };
        setItems([...items, item]);
        setNewDesc('');
        setNewQty('');
        setNewMedia(null);
    };

    const handleEditOrder = (order: FurnitureOrder) => {
        setEditingOrderId(order.id);
        setClientName(order.clientName);
        setAssemblerName(order.assemblerName);
        setOrderDate(order.date);
        setItems([...order.items]);
        setIsCreating(true);
    };

    const toggleOrderSelection = (order: FurnitureOrder, e: React.MouseEvent) => {
        e.stopPropagation();
        if (order.status === 'Completed') {
            // Revert to pending
            if(window.confirm("Deseja remover este registro do pedido gerado? Ele voltará a ficar 'Em Aberto'.")) {
                const updated = orders.map(o => 
                    o.id === order.id ? { ...o, status: 'Pending' as const, generatedOrderId: undefined, generatedOrderDate: undefined } : o
                );
                onUpdateOrders(updated);
            }
        } else {
            // Toggle selection
            setSelectedOrderIds(prev => 
                prev.includes(order.id) ? prev.filter(id => id !== order.id) : [...prev, order.id]
            );
        }
    };

    const handleGenerateOrder = () => {
        if (selectedOrderIds.length === 0) return;
        
        const newOrderId = generateUUID();
        const newOrderDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
        
        const updated = orders.map(o => 
            selectedOrderIds.includes(o.id) ? { ...o, status: 'Completed' as const, generatedOrderId: newOrderId, generatedOrderDate: newOrderDate } : o
        );
        onUpdateOrders(updated);
        setSelectedOrderIds([]);
        alert("Pedido gerado com sucesso!");
    };

    const saveOrder = () => {
        if (!clientName || !assemblerName || items.length === 0) return;

        if (editingOrderId) {
            const updatedOrders = orders.map(o => 
                o.id === editingOrderId 
                ? { ...o, clientName, assemblerName, date: orderDate, items } 
                : o
            );
            onUpdateOrders(updatedOrders);
        } else {
            const newOrder: FurnitureOrder = {
                id: generateUUID(),
                date: orderDate,
                clientName,
                assemblerName,
                items,
                status: 'Pending',
                createdAt: new Date().toISOString()
            };
            onUpdateOrders([newOrder, ...orders]);
        }
        
        closeModal();
    };

    const closeModal = () => {
        setIsCreating(false);
        setEditingOrderId(null);
        setClientName('');
        setAssemblerName('');
        setOrderDate(new Date().toLocaleDateString('en-CA'));
        setItems([]);
    };

    const removeOrder = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if(window.confirm("Remover este pedido?")) {
            onUpdateOrders(orders.filter(o => o.id !== id));
        }
    };

    const generateOrderPdf = async (orderGroup: { id: string, date: string }) => {
        setIsGeneratingPdf(true);
        const batchOrders = orders.filter(o => o.generatedOrderId === orderGroup.id);
        try {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = 210;
            const margin = 12;
            let y = 15;

            // Header Principal do PDF
            pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor(40);
            const formattedDate = new Date(orderGroup.date + 'T12:00:00Z').toLocaleDateString('pt-BR');
            pdf.text(`SOLICITAÇÃO DE MATERIAIS - DATA: ${formattedDate}`, margin, y);
            
            pdf.setFontSize(7).setFont('helvetica', 'normal').setTextColor(120);
            pdf.text(`EMISSÃO: ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, y, { align: 'right' });

            
            y += 6;
            pdf.setDrawColor(200).setLineWidth(0.1).line(margin, y, pageWidth - margin, y);
            y += 8;

            batchOrders.forEach((order) => {
                if (y > 270) { pdf.addPage(); y = 15; }

                // Faixa do Pedido (Cliente/Montador)
                pdf.setFillColor(245, 245, 245);
                pdf.rect(margin, y, pageWidth - (margin * 2), 6, 'F');
                pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(60);
                pdf.text(`${order.clientName.toUpperCase()}  |  MONTADOR: ${order.assemblerName.toUpperCase()}`, margin + 2, y + 4.2);
                y += 7.5;

                // Tabela de Itens (Ultra Compacta)
                pdf.setFontSize(7).setFont('helvetica', 'bold').setTextColor(140);
                pdf.text("CONF.", margin + 1, y);
                pdf.text("QTD", margin + 18, y, { align: 'right' });
                pdf.text("UN", margin + 20, y);
                pdf.text("DESCRIÇÃO DO MATERIAL", margin + 30, y);
                
                y += 2.5;
                pdf.setDrawColor(240).line(margin, y, pageWidth - margin, y);
                y += 4.5;

                pdf.setFontSize(7).setFont('helvetica', 'normal').setTextColor(0);
                order.items.forEach(item => {
                    if (y > 285) { 
                        pdf.addPage(); 
                        y = 15; 
                        // Repetir cabeçalho se quebrar no meio do pedido
                        pdf.setFillColor(245, 245, 245).rect(margin, y, pageWidth - (margin * 2), 6, 'F');
                        pdf.setFont('helvetica', 'bold').setFontSize(8).text(`${order.clientName.toUpperCase()} (CONT.)`, margin + 2, y + 4.2);
                        y += 10;
                    }
                    
                    pdf.setDrawColor(200).rect(margin + 1, y - 2.5, 3, 3); // Checkbox conferência
                    pdf.setFont('helvetica', 'bold').text(String(item.quantity), margin + 18, y, { align: 'right' });
                    pdf.setFont('helvetica', 'normal').text(item.unit.toLowerCase(), margin + 20, y);
                    
                    const desc = item.description.toUpperCase();
                    const splitDesc = pdf.splitTextToSize(desc, 160);
                    pdf.text(splitDesc, margin + 30, y);
                    
                    y += (splitDesc.length * 3.5) + 1.5;
                });
                y += 4; // Espaço entre pedidos do lote
            });

            // Rodapé simples
            const pageCount = pdf.internal.pages.length - 1;
            for(let i = 1; i <= pageCount; i++) {
                pdf.setPage(i);
                pdf.setFontSize(6).setTextColor(150);
                pdf.text(`Página ${i} de ${pageCount} - Gerado via Tracker System`, pageWidth / 2, 290, { align: 'center' });
            }

            pdf.save(`pedido_materiais_${orderGroup.date}.pdf`);
        } catch (e) {
            alert("Erro ao gerar PDF.");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const openOrders = filteredOrders.filter(o => o.status !== 'Completed');
    const completedOrders = filteredOrders.filter(o => o.status === 'Completed');

    const renderOrderTable = (ordersList: FurnitureOrder[], emptyMessage: string) => (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-900 text-white text-[10px] uppercase tracking-widest font-normal">
                            <th className="p-3 w-12 text-center">Sel.</th>
                            <th className="p-3 w-32">Data Reg.</th>
                            <th className="p-3 w-20 text-center">Dias</th>
                            <th className="p-3">Cliente</th>
                            <th className="p-3">Montador</th>
                            <th className="p-3 w-32 text-center">Data Pedido</th>
                            <th className="p-3 w-24 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {ordersList.length === 0 ? (
                            <tr><td colSpan={7} className="p-10 text-center text-slate-400 italic">{emptyMessage}</td></tr>
                        ) : (
                            ordersList.map(order => {
                                const daysOpen = calculateDaysElapsed(order.createdAt);
                                const isDone = order.status === 'Completed';
                                const isSelected = selectedOrderIds.includes(order.id);
                                return (
                                    <React.Fragment key={order.id}>
                                        <tr 
                                            onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                            className={`cursor-pointer transition-colors text-[14px] md:text-[10px] font-normal ${isDone ? 'bg-green-50/30' : 'hover:bg-slate-50'}`}
                                        >
                                            <td className="p-3 text-center" onClick={(e) => toggleOrderSelection(order, e)}>
                                                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all mx-auto ${isSelected || isDone ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white'}`}>
                                                    {(isSelected || isDone) && <CheckCircleIcon className="w-4 h-4 text-white" />}
                                                </div>
                                            </td>
                                            <td className="p-3 text-slate-500">{new Date(order.date + 'T12:00:00Z').toLocaleDateString('pt-BR')}</td>
                                            <td className="p-3 text-center">
                                                <span className={`px-2 py-0.5 rounded-full font-bold ${daysOpen > 5 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>
                                                    {daysOpen}d
                                                </span>
                                            </td>
                                            <td className={`p-3 uppercase text-slate-800 tracking-tight font-medium`}>{order.clientName}</td>
                                            <td className="p-3 uppercase text-slate-600">{order.assemblerName}</td>
                                            <td className="p-3 text-center">
                                                {order.generatedOrderDate ? (
                                                    <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md font-black border border-indigo-100">
                                                        {new Date(order.generatedOrderDate + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-300 italic">---</span>
                                                )}
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {!isDone && (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); handleEditOrder(order); }} 
                                                            className="text-slate-400 hover:text-blue-600"
                                                            title="Editar Registro"
                                                        >
                                                            <PencilIcon className="w-4 h-4"/>
                                                        </button>
                                                    )}

                                                    <button 
                                                        onClick={(e) => removeOrder(order.id, e)} 
                                                        className="text-slate-400 hover:text-red-500"
                                                        title="Excluir Registro"
                                                    >
                                                        <TrashIcon className="w-4 h-4"/>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedOrderId === order.id && (
                                            <tr className="bg-slate-50/50">
                                                <td colSpan={7} className="p-0 border-b">
                                                    <div className="p-4 bg-white m-2 rounded-lg border border-slate-200 shadow-inner animate-fadeIn">
                                                        <h4 className="text-[9px] font-bold text-slate-400 uppercase mb-3 tracking-widest flex items-center gap-2">
                                                            <ClockIcon className="w-3 h-3"/> Itens do Registro
                                                        </h4>
                                                        <table className="w-full text-left text-[14px] md:text-[10px]">
                                                            <thead className="border-b">
                                                                <tr className="text-slate-400 font-bold uppercase">
                                                                    <th className="pb-2 w-12 text-right pr-2">Qtd</th>
                                                                    <th className="pb-2 w-10">Un</th>
                                                                    <th className="pb-2">Descrição</th>
                                                                    <th className="pb-2 w-12 text-center">Foto</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y">
                                                                {order.items.map(item => (
                                                                    <tr key={item.id}>
                                                                        <td className="py-2 font-black text-right pr-2 text-blue-600">{item.quantity}</td>
                                                                        <td className="py-2 text-slate-400 font-bold uppercase">{item.unit}</td>
                                                                        <td className="py-2 uppercase text-slate-700">{item.description}</td>
                                                                        <td className="py-2 text-center">
                                                                            {item.media ? (
                                                                                <button onClick={() => setViewingMedia({ list: [item.media!], index: 0 })} className="text-blue-600"><CameraIcon className="w-4 h-4 mx-auto"/></button>
                                                                            ) : <span className="text-slate-300">---</span>}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderCompletedTable = () => {
        if (activeGeneratedOrders.length === 0) {
            return (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-900 text-white text-[10px] uppercase tracking-widest font-normal">
                                <th className="p-3 w-12 text-center"></th>
                                <th className="p-3">Data do Pedido</th>
                                <th className="p-3 text-center">Qtd Clientes</th>
                                <th className="p-3 text-center">Qtd Montadores</th>
                                <th className="p-3 w-24 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td colSpan={5} className="p-10 text-center text-slate-400 italic">Nenhum pedido concluído.</td></tr>
                        </tbody>
                    </table>
                </div>
            );
        }

        return (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-900 text-white text-[10px] uppercase tracking-widest font-normal">
                                <th className="p-3 w-12 text-center"></th>
                                <th className="p-3">Data do Pedido</th>
                                <th className="p-3 text-center">Qtd Clientes</th>
                                <th className="p-3 text-center">Qtd Montadores</th>
                                <th className="p-3 w-24 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {activeGeneratedOrders.map(batch => {
                                const batchOrders = orders.filter(o => o.generatedOrderId === batch.id);
                                const uniqueClients = new Set(batchOrders.map(o => o.clientName)).size;
                                const uniqueAssemblers = new Set(batchOrders.map(o => o.assemblerName)).size;
                                const isExpanded = expandedBatchId === batch.id;

                                return (
                                    <React.Fragment key={batch.id}>
                                        <tr 
                                            onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                                            className={`cursor-pointer transition-colors text-[14px] md:text-[10px] font-normal hover:bg-slate-50 ${isExpanded ? 'bg-slate-50' : ''}`}
                                        >
                                            <td className="p-3 text-center">
                                                <ChevronRightIcon className={`w-4 h-4 mx-auto transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                            </td>
                                            <td className="p-3 font-bold text-slate-700">
                                                {new Date(batch.date + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                                            </td>
                                            <td className="p-3 text-center text-slate-600">{uniqueClients}</td>
                                            <td className="p-3 text-center text-slate-600">{uniqueAssemblers}</td>
                                            <td className="p-3 text-right">
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); generateOrderPdf(batch); }}
                                                    className="text-slate-400 hover:text-indigo-600"
                                                    title="Imprimir Pedido"
                                                >
                                                    <PrinterIcon className="w-5 h-5 inline" />
                                                </button>
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr className="bg-slate-50/50">
                                                <td colSpan={5} className="p-0 border-b">
                                                    <div className="p-4 bg-white m-2 rounded-lg border border-slate-200 shadow-inner animate-fadeIn">
                                                        <h4 className="text-[9px] font-bold text-slate-400 uppercase mb-3 tracking-widest flex items-center gap-2">
                                                            <ClipboardListIcon className="w-3 h-3"/> Registros do Pedido
                                                        </h4>
                                                        <table className="w-full text-left text-[14px] md:text-[10px]">
                                                            <thead className="border-b">
                                                                <tr className="text-slate-400 font-bold uppercase">
                                                                    <th className="pb-2 w-12 text-center">Sel.</th>
                                                                    <th className="pb-2">Cliente</th>
                                                                    <th className="pb-2 w-24">Data Reg.</th>
                                                                    <th className="pb-2">Montador</th>
                                                                    <th className="pb-2 w-20 text-center">Itens</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y">
                                                                {batchOrders.map(record => {
                                                                    const isRecordExpanded = expandedRecordId === record.id;
                                                                    return (
                                                                        <React.Fragment key={record.id}>
                                                                            <tr 
                                                                                onClick={() => setExpandedRecordId(isRecordExpanded ? null : record.id)}
                                                                                className={`cursor-pointer hover:bg-slate-50 transition-colors ${isRecordExpanded ? 'bg-slate-50' : ''}`}
                                                                            >
                                                                                <td className="py-2 text-center" onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    const updated = orders.map(o => 
                                                                                        o.id === record.id ? { ...o, status: 'Pending' as const, generatedOrderId: undefined, generatedOrderDate: undefined } : o
                                                                                    );
                                                                                    onUpdateOrders(updated);
                                                                                }}>
                                                                                    <div className="w-4 h-4 rounded border flex items-center justify-center transition-all mx-auto bg-indigo-500 border-indigo-500">
                                                                                        <CheckCircleIcon className="w-3 h-3 text-white" />
                                                                                    </div>
                                                                                </td>
                                                                                <td className="py-2 uppercase text-slate-700 font-medium">{record.clientName}</td>
                                                                                <td className="py-2 text-slate-500">{new Date(record.date + 'T12:00:00Z').toLocaleDateString('pt-BR')}</td>
                                                                                <td className="py-2 uppercase text-slate-600">{record.assemblerName}</td>
                                                                                <td className="py-2 text-center text-slate-500 font-bold">{record.items.length}</td>
                                                                            </tr>
                                                                            {isRecordExpanded && (
                                                                                <tr className="bg-slate-50">
                                                                                    <td colSpan={5} className="p-0">
                                                                                        <div className="p-3 m-2 bg-white rounded border shadow-sm">
                                                                                            <table className="w-full text-left text-[9px]">
                                                                                                <thead className="border-b">
                                                                                                    <tr className="text-slate-400 font-bold uppercase">
                                                                                                        <th className="pb-1 w-10 text-right pr-2">Qtd</th>
                                                                                                        <th className="pb-1 w-8">Un</th>
                                                                                                        <th className="pb-1">Descrição</th>
                                                                                                        <th className="pb-1 w-10 text-center">Foto</th>
                                                                                                    </tr>
                                                                                                </thead>
                                                                                                <tbody className="divide-y">
                                                                                                    {record.items.map(item => (
                                                                                                        <tr key={item.id}>
                                                                                                            <td className="py-1 font-black text-right pr-2 text-blue-600">{item.quantity}</td>
                                                                                                            <td className="py-1 text-slate-400 font-bold uppercase">{item.unit}</td>
                                                                                                            <td className="py-1 uppercase text-slate-700">{item.description}</td>
                                                                                                            <td className="py-1 text-center">
                                                                                                                {item.media ? (
                                                                                                                    <button onClick={(e) => { e.stopPropagation(); setViewingMedia({ list: [item.media!], index: 0 }); }} className="text-blue-600"><CameraIcon className="w-3 h-3 mx-auto"/></button>
                                                                                                                ) : <span className="text-slate-300">---</span>}
                                                                                                            </td>
                                                                                                        </tr>
                                                                                                    ))}
                                                                                                </tbody>
                                                                                            </table>
                                                                                        </div>
                                                                                    </td>
                                                                                </tr>
                                                                            )}
                                                                        </React.Fragment>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-100 p-2 rounded-lg"><ShoppingCartIcon className="w-6 h-6 text-blue-600"/></div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Pedidos de Materiais</h2>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Controle de Pedidos e Envios</p>
                    </div>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <button 
                        onClick={() => setShowManifest(true)}
                        className="flex-1 md:flex-none bg-slate-800 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-black transition-all"
                    >
                        <ClipboardListIcon className="w-5 h-5"/> Pedidos Gerados ({activeGeneratedOrders.length})
                    </button>
                    <button 
                        onClick={() => setIsCreating(true)}
                        className="flex-1 md:flex-none bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all"
                    >
                        <PlusCircleIcon className="w-5 h-5"/> Novo Registro
                    </button>
                </div>
            </div>

            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><SearchIcon className="w-4 h-4" /></div>
                <input 
                    type="text" 
                    placeholder="Filtrar por cliente, montador ou código..." 
                    value={searchTerm} 
                    onChange={e => setSearchTerm(e.target.value)} 
                    className="w-full pl-10 pr-4 py-2 bg-white border rounded-xl outline-none focus:ring-1 focus:ring-blue-500"
                />
            </div>

            <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                <button 
                    onClick={() => setActiveTab('OPEN')}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'OPEN' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Em Aberto ({openOrders.length})
                </button>
                <button 
                    onClick={() => setActiveTab('COMPLETED')}
                    className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'COMPLETED' ? 'bg-white text-green-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Concluídos ({completedOrders.length})
                </button>
            </div>

            {/* Orders Table */}
            <div className="space-y-3">
                {selectedOrderIds.length > 0 && (
                    <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="bg-indigo-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
                                {selectedOrderIds.length}
                            </div>
                            <span className="text-indigo-900 font-medium text-sm">
                                {selectedOrderIds.length === 1 ? 'registro selecionado' : 'registros selecionados'}
                            </span>
                        </div>
                        <button 
                            onClick={handleGenerateOrder}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
                        >
                            <CheckCircleIcon className="w-4 h-4" />
                            Gerar Pedido
                        </button>
                    </div>
                )}

                {activeTab === 'OPEN' ? (
                    renderOrderTable(openOrders, "Nenhum pedido em aberto.")
                ) : (
                    renderCompletedTable()
                )}
            </div>

            {/* Create/Edit Modal */}
            {isCreating && (
                <Modal onClose={closeModal}>
                    <div className="p-2 space-y-4">
                        <div className="flex justify-between items-center border-b pb-3">
                            <h3 className="text-lg font-bold text-slate-800 uppercase tracking-tighter">
                                {editingOrderId ? 'Editar Registro' : 'Novo Pedido de Material'}
                            </h3>
                            <button onClick={closeModal}><XIcon className="w-6 h-6 text-slate-400"/></button>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cliente</label>
                                <input value={clientName} onChange={e => setClientName(e.target.value)} list="client-list" className="w-full p-2 border rounded-lg uppercase text-sm" placeholder="João Silva..." />
                                <datalist id="client-list">{clients.map(c => <option key={c.id} value={c.name}/>)}</datalist>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Montador</label>
                                <select value={assemblerName} onChange={e => setAssemblerName(e.target.value)} className="w-full p-2 border rounded-lg uppercase bg-white text-sm">
                                    <option value="">Selecione...</option>
                                    {assemblers.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Data</label>
                                <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                            </div>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-xl border border-dashed border-slate-300 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                                <div className="md:col-span-1 flex gap-1">
                                    <div className="flex-1">
                                        <label className="block text-[9px] font-bold text-slate-400">QTD</label>
                                        <input type="number" value={newQty} onChange={e => setNewQty(e.target.value)} className="w-full p-2 border rounded-lg font-bold" placeholder="0" />
                                    </div>
                                    <div className="w-16">
                                        <label className="block text-[9px] font-bold text-slate-400">UN</label>
                                        <select value={newUnit} onChange={e => setNewUnit(e.target.value)} className="w-full p-2 border rounded-lg bg-white">
                                            <option value="un">UN</option>
                                            <option value="cx">CX</option>
                                            <option value="mt">MT</option>
                                            <option value="pc">PC</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-[9px] font-bold text-slate-400">DESCRIÇÃO DO ITEM</label>
                                    <input value={newDesc} onChange={e => setNewDesc(e.target.value)} className="w-full p-2 border rounded-lg uppercase" placeholder="Ex: Puxador, Dobradiça..." />
                                </div>
                                <div className="flex gap-2">
                                    <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                                    <button 
                                        type="button" 
                                        onClick={() => fileInputRef.current?.click()} 
                                        className={`p-2 border rounded-lg transition-colors ${newMedia ? 'bg-green-500 text-white' : 'bg-white text-slate-400 hover:text-blue-500'}`}
                                    >
                                        {uploading ? <RefreshIcon className="w-5 h-5 animate-spin"/> : <CameraIcon className="w-5 h-5"/>}
                                    </button>
                                    <button onClick={addItem} className="flex-grow bg-slate-800 text-white px-3 py-2 rounded-lg font-bold text-[10px] uppercase">Incluir</button>
                                </div>
                            </div>
                        </div>

                        {items.length > 0 && (
                            <div className="border rounded-lg overflow-hidden bg-white max-h-[250px] overflow-y-auto">
                                <table className="w-full text-left text-[10px]">
                                    <thead className="bg-slate-100 sticky top-0">
                                        <tr className="text-slate-500">
                                            <th className="p-2 w-12 text-right pr-2">Qtd</th>
                                            <th className="p-2 w-10">Un</th>
                                            <th className="p-2">Item</th>
                                            <th className="p-2 w-10 text-right"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {items.map(it => (
                                            <tr key={it.id}>
                                                <td className="p-2 font-black text-right pr-2 text-blue-600">{it.quantity}</td>
                                                <td className="p-2 text-slate-400 font-bold uppercase">{it.unit}</td>
                                                <td className="p-2 uppercase text-slate-700">{it.description} {it.media && <CameraIcon className="w-3 h-3 inline ml-1 text-blue-400"/>}</td>
                                                <td className="p-2 text-right">
                                                    <button onClick={() => setItems(items.filter(x => x.id !== it.id))} className="text-red-300 hover:text-red-500">
                                                        <TrashIcon className="w-4 h-4"/>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 border-t pt-4">
                            <button onClick={closeModal} className="px-6 py-2 text-slate-500 font-bold text-xs">Cancelar</button>
                            <button onClick={saveOrder} disabled={items.length === 0} className="px-10 py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase shadow-lg disabled:opacity-50">
                                {editingOrderId ? 'Atualizar Registro' : 'Finalizar Registro'}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Pedidos Gerados Modal */}
            {showManifest && (
                <Modal onClose={() => setShowManifest(false)}>
                    <div className="p-2 space-y-4 max-h-[85vh] flex flex-col">
                        <div className="flex justify-between items-center border-b pb-3">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                                    <ClipboardListIcon className="w-6 h-6 text-indigo-600" />
                                    Pedidos Gerados
                                </h3>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{activeGeneratedOrders.length} Pedidos Disponíveis</p>
                            </div>
                            <button onClick={() => setShowManifest(false)}><XIcon className="w-6 h-6 text-slate-400"/></button>
                        </div>

                        <div className="flex-grow overflow-y-auto space-y-6">
                            {activeGeneratedOrders.length === 0 ? (
                                <div className="text-center py-20 bg-slate-50 rounded-xl border-2 border-dashed">
                                    <ShoppingCartIcon className="w-12 h-12 text-slate-200 mx-auto mb-2"/>
                                    <p className="text-slate-400 font-bold uppercase text-[10px]">Nenhum pedido gerado ainda.</p>
                                </div>
                            ) : (
                                activeGeneratedOrders.map(orderGroup => {
                                    const batchOrders = orders.filter(o => o.generatedOrderId === orderGroup.id);
                                    const formattedDate = new Date(orderGroup.date + 'T12:00:00Z').toLocaleDateString('pt-BR');
                                    return (
                                        <div key={orderGroup.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                            <div className="bg-slate-900 px-4 py-2 border-b flex justify-between items-center text-white">
                                                <div>
                                                    <h4 className="font-black uppercase text-sm leading-tight flex items-center gap-2">
                                                        <TagIcon className="w-4 h-4 text-indigo-400" />
                                                        DATA DO PEDIDO: {formattedDate}
                                                    </h4>
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{batchOrders.length} Registros Agrupados</p>
                                                </div>
                                                <button 
                                                    onClick={() => generateOrderPdf(orderGroup)}
                                                    className="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors"
                                                >
                                                    <PrinterIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                            
                                            <div className="divide-y divide-slate-100">
                                                {batchOrders.map(order => (
                                                    <div key={order.id} className="p-3 bg-white">
                                                        <div className="flex justify-between items-center mb-2">
                                                            <span className="text-[10px] font-black text-slate-700 uppercase">{order.clientName}</span>
                                                            <span className="text-[9px] text-slate-400 font-bold">{order.assemblerName}</span>
                                                        </div>
                                                        <div className="grid grid-cols-[30px_35px_1fr] gap-2 mb-1 pb-1 border-b text-[8px] font-black text-slate-300 uppercase tracking-widest">
                                                            <div className="text-right pr-2">Qtd</div>
                                                            <div>Un</div>
                                                            <div>Descrição</div>
                                                        </div>
                                                        <div className="space-y-1">
                                                            {order.items.map(it => (
                                                                <div key={it.id} className="grid grid-cols-[30px_35px_1fr] gap-2 items-start text-[9px] text-slate-600 uppercase">
                                                                    <div className="text-right pr-2 font-black text-indigo-700">{it.quantity}</div>
                                                                    <div className="font-bold text-slate-400 text-[8px]">{it.unit}</div>
                                                                    <div className="font-medium text-slate-800 truncate">{it.description}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <div className="flex justify-between items-center border-t pt-4">
                            <button 
                                onClick={() => {
                                    if(window.confirm("Limpar todos os agrupamentos? Todos os pedidos voltarão a ser 'Pendentes'.")) {
                                        onUpdateOrders(orders.map(o => ({ ...o, status: 'Pending', generatedOrderId: undefined, generatedOrderDate: undefined })));
                                        setShowManifest(false);
                                    }
                                }} 
                                className="text-red-400 hover:text-red-600 text-[10px] font-bold uppercase"
                            >
                                Resetar Pedidos
                            </button>
                            <button 
                                onClick={() => setShowManifest(false)}
                                className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase shadow-lg"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Media Viewer Logic Reused */}
            {viewingMedia && (
                <Modal onClose={() => setViewingMedia(null)} fullScreen={true}>
                    <div className="w-full h-full bg-black/95 flex items-center justify-center relative">
                        <img src={getDisplayableDriveUrl(viewingMedia.list[viewingMedia.index].url) || undefined} className="max-h-full max-w-full object-contain" />
                        <button onClick={() => setViewingMedia(null)} className="absolute top-4 right-4 text-white p-2"><XIcon className="w-8 h-8"/></button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default FurnitureOrderManager;
