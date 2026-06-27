import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ProjectSetupPage() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  
  // Minimal BOQ Item state
  const [wbsCode, setWbsCode] = useState('WBS.1.1');
  const [itemName, setItemName] = useState('Pekerjaan Persiapan');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('ls');
  const [plannedCost, setPlannedCost] = useState(10000000);
  
  const [submitting, setSubmitting] = useState(false);
  const { token, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !activeWorkspaceId) return;

    setSubmitting(true);
    try {
      // 1. Create Project
      const projRes = await fetch('http://localhost:3000/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name, code, description, workspaceId: activeWorkspaceId })
      });
      if (!projRes.ok) throw new Error('Failed to create project');
      const project = await projRes.json();

      // 2. Initiate Setup
      const initRes = await fetch(`http://localhost:3000/projects/${project.id}/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          items: [{ wbsCode, name: itemName, quantity: Number(quantity), unit, plannedCost: Number(plannedCost) }]
        })
      });
      if (!initRes.ok) throw new Error('Failed to initiate project setup');

      alert('Project initiated successfully! Baseline Active.');
      navigate(`/project/${project.id}`);
    } catch (err: any) {
      alert(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: 'white', padding: 'var(--space-8)', borderRadius: 'var(--radius-lg)' }}>
      <h2 style={{ fontSize: 'var(--text-2xl)', color: 'var(--simprok-engineering-blue-900)', marginBottom: 'var(--space-6)' }}>Start New Project</h2>
      <form onSubmit={handleSetup} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <label>Project Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%', padding: '8px' }}/>
        </div>
        <div>
          <label>Project Code</label>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required style={{ width: '100%', padding: '8px' }}/>
        </div>
        <div>
          <label>Description</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: '8px' }}/>
        </div>

        <h3 style={{ marginTop: 'var(--space-4)' }}>Initial BOQ Item (Required to Activate Baseline)</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input type="text" value={wbsCode} onChange={(e) => setWbsCode(e.target.value)} placeholder="WBS Code" required style={{ flex: 1, padding: '8px' }}/>
          <input type="text" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Item Name" required style={{ flex: 2, padding: '8px' }}/>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantity" required style={{ flex: 1, padding: '8px' }}/>
          <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" required style={{ flex: 1, padding: '8px' }}/>
          <input type="number" value={plannedCost} onChange={(e) => setPlannedCost(e.target.value)} placeholder="Planned Cost (IDR)" required style={{ flex: 2, padding: '8px' }}/>
        </div>

        <button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-6)', padding: '12px', backgroundColor: 'var(--simprok-engineering-blue-600)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {submitting ? 'Creating...' : 'Create & Activate Baseline'}
        </button>
      </form>
    </div>
  );
}
