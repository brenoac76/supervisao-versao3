import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Arrow, Text, Circle, Transformer, Label, Tag } from 'react-konva';
import useImage from 'use-image';
import { Media, Annotation } from '../types';
import { generateUUID } from '../App';
import { XIcon, TypeIcon, ArrowUpRightIcon, CircleIcon, Trash2Icon, SaveIcon, RotateCwIcon } from 'lucide-react';

interface PhotoEditorProps {
  media: Media;
  onSave: (updatedMedia: Media) => void;
  onClose: () => void;
}

const getDisplayableDriveUrl = (url: string): string | undefined => {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const driveRegex = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/;
  const match = url.match(driveRegex);
  if (match && match[1]) return `https://lh3.googleusercontent.com/d/${match[1]}`;
  return url;
};

const PhotoEditor: React.FC<PhotoEditorProps> = ({ media, onSave, onClose }) => {
  const displayUrl = getDisplayableDriveUrl(media.originalUrl || media.url);
  const [image] = useImage(displayUrl || '', 'anonymous');
  const [annotations, setAnnotations] = useState<Annotation[]>(media.annotations || []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const stageRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0, scale: 1 });
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedAnnotation = annotations.find(a => a.id === selectedId);

  useEffect(() => {
    if (containerRef.current && image) {
      const containerWidth = containerRef.current.clientWidth;
      const containerHeight = containerRef.current.clientHeight;
      
      const imageRatio = image.width / image.height;
      const containerRatio = containerWidth / containerHeight;
      
      let renderWidth, renderHeight;
      if (imageRatio > containerRatio) {
        renderWidth = containerWidth;
        renderHeight = containerWidth / imageRatio;
      } else {
        renderHeight = containerHeight;
        renderWidth = containerHeight * imageRatio;
      }
      
      setStageSize({ 
        width: renderWidth, 
        height: renderHeight,
        scale: renderWidth / image.width
      });
    }
  }, [image]);

  useEffect(() => {
    if (trRef.current) {
      if (selectedId) {
        const selectedNode = stageRef.current.findOne('#' + selectedId);
        if (selectedNode) {
          trRef.current.nodes([selectedNode]);
        } else {
          trRef.current.nodes([]);
        }
      } else {
        trRef.current.nodes([]);
      }
      trRef.current.getLayer().batchDraw();
    }
  }, [selectedId, annotations]);

  const handleAddText = () => {
    const newAnnotation: Annotation = {
      id: generateUUID(),
      type: 'text',
      x: stageSize.width / 2,
      y: stageSize.height / 2,
      content: 'Novo Texto',
      color: '#FFFFFF', // Default to white
      scale: 1,
      angle: 0,
      width: 150 // Default width for wrapping
    };
    setAnnotations([...annotations, newAnnotation]);
    setSelectedId(newAnnotation.id);
  };

  const handleAddArrow = () => {
    const newAnnotation: Annotation = {
      id: generateUUID(),
      type: 'arrow',
      x: stageSize.width / 2,
      y: stageSize.height / 2,
      color: '#ff0000',
      scale: 1,
      angle: 0,
      width: 100 // length
    };
    setAnnotations([...annotations, newAnnotation]);
    setSelectedId(newAnnotation.id);
  };

  const handleAddCircle = () => {
    const newAnnotation: Annotation = {
      id: generateUUID(),
      type: 'circle',
      x: stageSize.width / 2,
      y: stageSize.height / 2,
      color: '#ff0000',
      scale: 1,
      angle: 0,
      radius: 50
    };
    setAnnotations([...annotations, newAnnotation]);
    setSelectedId(newAnnotation.id);
  };

  const handleDeleteSelected = () => {
    if (selectedId) {
      setAnnotations(prev => prev.filter(a => a.id !== selectedId));
      setSelectedId(null);
    }
  };

  const handleRevertAll = () => {
    if (window.confirm("Deseja remover todas as marcações desta foto?")) {
      setAnnotations([]);
      setSelectedId(null);
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  const handleSave = async () => {
    if (stageRef.current && !isSaving) {
      setIsSaving(true);
      setSelectedId(null);
      
      // Small delay to ensure Transformer is hidden before capturing
      setTimeout(async () => {
        try {
          const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
          await onSave({
            ...media,
            url: dataURL,
            originalUrl: media.originalUrl || media.url, // Ensure original is kept
            annotations: annotations
          });
        } catch (error) {
          console.error("Erro ao salvar:", error);
          setIsSaving(false);
        }
      }, 50);
    }
  };

  const handleTransformEnd = (e: any) => {
    const node = e.target;
    const id = node.id();
    const ann = annotations.find(a => a.id === id);
    if (!ann) return;

    if (ann.type === 'text') {
      // For text, we update width and scale
      const newWidth = Math.max(5, node.width() * node.scaleX());
      setAnnotations(
        annotations.map((a) =>
          a.id === id 
            ? { 
                ...a, 
                x: node.x(), 
                y: node.y(), 
                angle: node.rotation(),
                width: newWidth,
                scale: 1 // Reset scale after applying to width
              } 
            : a
        )
      );
      node.scaleX(1);
      node.scaleY(1);
    } else {
      setAnnotations(
        annotations.map((a) =>
          a.id === id 
            ? { 
                ...a, 
                x: node.x(), 
                y: node.y(), 
                scale: node.scaleX(), 
                angle: node.rotation() 
              } 
            : a
        )
      );
    }
  };

  const handleDragEnd = (e: any) => {
    const node = e.target;
    const id = node.id();
    const newAnnotations = annotations.map(a => {
      if (a.id === id) {
        return { ...a, x: node.x(), y: node.y() };
      }
      return a;
    });
    setAnnotations(newAnnotations);
  };

  const handleTextChange = (id: string, content: string) => {
    setAnnotations(annotations.map(a => a.id === id ? { ...a, content } : a));
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-[999] flex flex-col">
      {/* Toolbar */}
      <div className="bg-slate-900 p-4 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="text-slate-400 hover:text-white p-2">
            <XIcon className="w-6 h-6" />
          </button>
          <h3 className="text-white font-medium text-sm uppercase tracking-widest">Editor de Foto</h3>
        </div>

        <div className="flex items-center gap-2">
          {selectedAnnotation?.type === 'text' && (
            <div className="flex items-center gap-2 mr-4 bg-slate-800 p-1 px-2 rounded-lg border border-slate-700">
              <span className="text-[9px] text-slate-500 uppercase font-bold">Texto:</span>
              <input 
                type="text" 
                value={selectedAnnotation.content || ''} 
                onChange={(e) => handleTextChange(selectedAnnotation.id, e.target.value)}
                className="bg-transparent border-none outline-none text-white text-xs w-32"
                autoFocus
              />
            </div>
          )}
          <button onClick={handleAddText} className="bg-slate-800 text-white p-2 rounded-lg hover:bg-slate-700 flex items-center gap-2 px-3 text-xs uppercase tracking-wider">
            <TypeIcon className="w-4 h-4" /> Texto
          </button>
          <button onClick={handleAddArrow} className="bg-slate-800 text-white p-2 rounded-lg hover:bg-slate-700 flex items-center gap-2 px-3 text-xs uppercase tracking-wider">
            <ArrowUpRightIcon className="w-4 h-4" /> Seta
          </button>
          <button onClick={handleAddCircle} className="bg-slate-800 text-white p-2 rounded-lg hover:bg-slate-700 flex items-center gap-2 px-3 text-xs uppercase tracking-wider">
            <CircleIcon className="w-4 h-4" /> Círculo
          </button>
          <div className="w-px h-6 bg-slate-700 mx-2" />
          <button onClick={handleDeleteSelected} disabled={!selectedId} className="bg-red-900/50 text-red-400 p-2 rounded-lg hover:bg-red-900 flex items-center gap-2 px-3 text-xs uppercase tracking-wider disabled:opacity-30">
            <Trash2Icon className="w-4 h-4" /> Excluir
          </button>
          <button onClick={handleRevertAll} className="bg-slate-800 text-slate-400 p-2 rounded-lg hover:bg-slate-700 flex items-center gap-2 px-3 text-xs uppercase tracking-wider" title="Remover todas as marcações">
            <RotateCwIcon className="w-4 h-4" /> Reverter
          </button>
        </div>

        <button 
          onClick={handleSave} 
          disabled={isSaving}
          className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 px-4 text-xs uppercase tracking-wider font-bold disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <RotateCwIcon className="w-4 h-4 animate-spin" /> Salvando...
            </>
          ) : (
            <>
              <SaveIcon className="w-4 h-4" /> Salvar Alterações
            </>
          )}
        </button>
      </div>

      {/* Canvas Area */}
      <div ref={containerRef} className="flex-grow relative overflow-hidden flex items-center justify-center bg-slate-950">
        {stageSize.width > 0 && (
          <Stage
            width={stageSize.width}
            height={stageSize.height}
            ref={stageRef}
            onMouseDown={(e) => {
              const clickedOnEmpty = e.target === e.target.getStage();
              if (clickedOnEmpty) {
                setSelectedId(null);
              }
            }}
          >
            <Layer>
              {image && (
                <KonvaImage
                  image={image}
                  width={stageSize.width}
                  height={stageSize.height}
                  listening={false}
                />
              )}
              {annotations.map((ann) => {
                if (ann.type === 'text') {
                  return (
                    <Label
                      key={ann.id}
                      id={ann.id}
                      x={ann.x}
                      y={ann.y}
                      draggable
                      rotation={ann.angle || 0}
                      scaleX={ann.scale || 1}
                      scaleY={ann.scale || 1}
                      onMouseDown={() => handleSelect(ann.id)}
                      onTap={() => handleSelect(ann.id)}
                      onDragStart={() => handleSelect(ann.id)}
                      onDragEnd={handleDragEnd}
                      onTransformEnd={handleTransformEnd}
                    >
                      <Tag
                        fill="#dc2626" // red-600
                        cornerRadius={8}
                        shadowColor="black"
                        shadowBlur={4}
                        shadowOpacity={0.2}
                        shadowOffset={{ x: 1, y: 1 }}
                      />
                      <Text
                        text={ann.content || ''}
                        fontSize={18}
                        fill={ann.color}
                        padding={8}
                        fontStyle="normal"
                        fontFamily="Inter, sans-serif"
                        width={ann.width || 150}
                        wrap="word"
                      />
                    </Label>
                  );
                }
                if (ann.type === 'arrow') {
                  return (
                    <Arrow
                      key={ann.id}
                      id={ann.id}
                      x={ann.x}
                      y={ann.y}
                      points={[0, 0, ann.width || 100, 0]}
                      pointerLength={10}
                      pointerWidth={10}
                      fill={ann.color}
                      stroke={ann.color}
                      strokeWidth={4}
                      draggable
                      rotation={ann.angle || 0}
                      scaleX={ann.scale || 1}
                      scaleY={ann.scale || 1}
                      onMouseDown={() => handleSelect(ann.id)}
                      onTap={() => handleSelect(ann.id)}
                      onDragStart={() => handleSelect(ann.id)}
                      onDragEnd={handleDragEnd}
                      onTransformEnd={handleTransformEnd}
                    />
                  );
                }
                if (ann.type === 'circle') {
                  return (
                    <Circle
                      key={ann.id}
                      id={ann.id}
                      x={ann.x}
                      y={ann.y}
                      radius={ann.radius || 50}
                      stroke={ann.color}
                      strokeWidth={3}
                      dash={[5, 5]}
                      draggable
                      rotation={ann.angle || 0}
                      scaleX={ann.scale || 1}
                      scaleY={ann.scale || 1}
                      onMouseDown={() => handleSelect(ann.id)}
                      onTap={() => handleSelect(ann.id)}
                      onDragStart={() => handleSelect(ann.id)}
                      onDragEnd={handleDragEnd}
                      onTransformEnd={handleTransformEnd}
                    />
                  );
                }
                return null;
              })}
              <Transformer
                ref={trRef}
                enabledAnchors={
                  selectedAnnotation?.type === 'text' 
                    ? ['middle-left', 'middle-right'] 
                    : ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                }
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 5 || newBox.height < 5) {
                    return oldBox;
                  }
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-slate-900 p-2 text-center text-[10px] text-slate-500 uppercase tracking-widest border-t border-slate-800">
        Arraste para mover • Use os quadrados para redimensionar e girar • Clique duplo no texto para editar
      </div>
    </div>
  );
};

export default PhotoEditor;
