import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, 
  Calendar as CalendarIcon, 
  CheckCircle2, 
  Circle, 
  Plus, 
  Trash2, 
  Briefcase, 
  User as UserIcon,
  Clock,
  Pencil,
  Check,
  X
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc 
} from 'firebase/firestore';

// --- Firebase Initialization ---
// We use the environment variables provided by the platform
const appId = typeof __app_id !== 'undefined' ? __app_id : 'vibe-planner-app';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase init error:", e);
}

// --- Date & Time Helpers ---
const getCurrentWeek = () => {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 is Sunday
  const numDay = today.getDate();

  const start = new Date(today);
  start.setDate(numDay - dayOfWeek); // Go to Sunday

  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    week.push(d);
  }
  return week;
};

const formatTime = (date) => {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function DailyPlanner() {
  const [user, setUser] = useState(null);
  const [todos, setTodos] = useState([]);
  const [schedule, setSchedule] = useState([]);
  
  // UI State
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskType, setNewTaskType] = useState('personal'); // 'personal' or 'work'
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newScheduleTitle, setNewScheduleTitle] = useState('');
  const [newScheduleStartTime, setNewScheduleStartTime] = useState('12:00');
  const [newScheduleEndTime, setNewScheduleEndTime] = useState('13:00');
  const [isAddingSchedule, setIsAddingSchedule] = useState(false);

  // Edit Schedule State
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [editScheduleTitle, setEditScheduleTitle] = useState('');
  const [editScheduleStartTime, setEditScheduleStartTime] = useState('');
  const [editScheduleEndTime, setEditScheduleEndTime] = useState('');

  // Edit To-Do State
  const [editingTodoId, setEditingTodoId] = useState(null);
  const [editTodoText, setEditTodoText] = useState('');
  const [editTodoType, setEditTodoType] = useState('personal');

  const week = getCurrentWeek();
  const today = new Date();

  // --- Authentication ---
  useEffect(() => {
    const authenticate = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
      }
    };

    authenticate();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  // --- Firestore Cloud Sync for To-Dos ---
  useEffect(() => {
    if (!user) return;

    // RULE 1: Strict Paths - Users private data collection
    const todosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'todos');
    
    // RULE 2: No Complex Queries - Fetch all, sort in memory
    const q = query(todosRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTodos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort by creation time (newest first)
      fetchedTodos.sort((a, b) => b.createdAt - a.createdAt);
      setTodos(fetchedTodos);
    }, (error) => {
      console.error("Firestore Error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // --- Firestore Cloud Sync for Schedule ---
  useEffect(() => {
    if (!user) return;

    const scheduleRef = collection(db, 'artifacts', appId, 'users', user.uid, 'schedule');
    const q = query(scheduleRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const todayStr = new Date().toDateString();
      const fetchedSchedule = [];

      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        
        // Only keep events for today. Wipe old events to start fresh each day.
        if (data.date === todayStr) {
          fetchedSchedule.push({ id: docSnap.id, ...data });
        } else {
          // Clean up old events from the database
          deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', docSnap.id))
            .catch(err => console.error("Error deleting old schedule:", err));
        }
      });
      
      // Sort chronologically
      fetchedSchedule.sort((a, b) => a.time.localeCompare(b.time));
      setSchedule(fetchedSchedule);
    }, (error) => {
      console.error("Firestore Error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // --- To-Do Actions ---
  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!user || !newTaskText.trim()) return;

    try {
      const todosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'todos');
      await addDoc(todosRef, {
        text: newTaskText.trim(),
        type: newTaskType,
        completed: false,
        createdAt: Date.now()
      });
      setNewTaskText('');
      setIsAddingTask(false);
    } catch (error) {
      console.error("Error adding todo:", error);
    }
  };

  const toggleTodo = async (todo) => {
    if (!user) return;
    try {
      const todoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'todos', todo.id);
      await updateDoc(todoRef, {
        completed: !todo.completed
      });
    } catch (error) {
      console.error("Error toggling todo:", error);
    }
  };

  const deleteTodo = async (id) => {
    if (!user) return;
    try {
      const todoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'todos', id);
      await deleteDoc(todoRef);
    } catch (error) {
      console.error("Error deleting todo:", error);
    }
  };

  const startEditingTodo = (todo) => {
    setEditingTodoId(todo.id);
    setEditTodoText(todo.text);
    setEditTodoType(todo.type || 'personal');
  };

  const cancelEditingTodo = () => {
    setEditingTodoId(null);
    setEditTodoText('');
    setEditTodoType('personal');
  };

  const handleUpdateTodo = async (e) => {
    e.preventDefault();
    if (!user || !editingTodoId || !editTodoText.trim()) return;

    try {
      const todoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'todos', editingTodoId);
      await updateDoc(todoRef, {
        text: editTodoText.trim(),
        type: editTodoType
      });
      cancelEditingTodo();
    } catch (error) {
      console.error("Error updating todo:", error);
    }
  };

  // --- Schedule Actions (Cloud Synced) ---
  const handleAddSchedule = async (e) => {
    e.preventDefault();
    if (!user || !newScheduleTitle.trim()) return;

    const colors = [
      'bg-pink-100 text-pink-900 border-pink-200',
      'bg-blue-100 text-blue-900 border-blue-200',
      'bg-yellow-100 text-yellow-900 border-yellow-200',
      'bg-green-100 text-green-900 border-green-200',
      'bg-purple-100 text-purple-900 border-purple-200'
    ];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    try {
      const scheduleRef = collection(db, 'artifacts', appId, 'users', user.uid, 'schedule');
      await addDoc(scheduleRef, {
        time: newScheduleStartTime,
        endTime: newScheduleEndTime,
        title: newScheduleTitle.trim(),
        duration: 'Scheduled',
        color: randomColor,
        date: new Date().toDateString(),
        createdAt: Date.now()
      });
      
      setNewScheduleTitle('');
      setIsAddingSchedule(false);
    } catch (error) {
      console.error("Error adding schedule:", error);
    }
  };

  const startEditingSchedule = (event) => {
    setEditingScheduleId(event.id);
    setEditScheduleTitle(event.title);
    setEditScheduleStartTime(event.time || '12:00');
    setEditScheduleEndTime(event.endTime || '');
  };

  const cancelEditingSchedule = () => {
    setEditingScheduleId(null);
    setEditScheduleTitle('');
    setEditScheduleStartTime('');
    setEditScheduleEndTime('');
  };

  const handleUpdateSchedule = async (e) => {
    e.preventDefault();
    if (!user || !editingScheduleId || !editScheduleTitle.trim()) return;

    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', editingScheduleId);
      await updateDoc(docRef, {
        title: editScheduleTitle.trim(),
        time: editScheduleStartTime,
        endTime: editScheduleEndTime
      });
      cancelEditingSchedule();
    } catch (error) {
      console.error("Error updating schedule:", error);
    }
  };

  const deleteSchedule = async (id) => {
    if (!user) return;
    try {
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'schedule', id);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error deleting schedule:", error);
    }
  };

  // --- Render Helpers ---
  const personalTodos = todos.filter(t => t.type === 'personal' && !t.completed);
  const workTodos = todos.filter(t => t.type === 'work' && !t.completed);
  const completedTodos = todos.filter(t => t.completed);

  const formattedMonthYear = today.toLocaleString('da-DK', { month: 'long', year: 'numeric' });
  const capitalizedMonthYear = formattedMonthYear.charAt(0).toUpperCase() + formattedMonthYear.slice(1);

  return (
    <div className="min-h-screen bg-[#eef5ef] p-4 md:p-8 flex justify-center font-sans text-gray-800">
      {/* Web-optimized container */}
      <div className="w-full max-w-6xl bg-[#f6fbf6] min-h-[90vh] rounded-[40px] shadow-2xl relative overflow-hidden flex flex-col">
        
        {/* Header Area */}
        <div className="px-8 md:px-12 pt-12 pb-6">
          <div className="flex justify-between items-center mb-8">
            <button className="p-3 bg-white rounded-full shadow-sm text-gray-600 hover:bg-gray-50 transition-colors">
              <ChevronLeft size={24} />
            </button>
            <div className="flex items-center space-x-2 bg-white px-5 py-2.5 rounded-full shadow-sm text-sm font-medium">
              <span>{capitalizedMonthYear}</span>
              <CalendarIcon size={18} className="text-gray-500" />
            </div>
          </div>

          <h1 className="text-4xl font-light text-gray-600">Din daglige</h1>
          <h2 className="text-5xl font-bold text-gray-900 tracking-tight mt-2">Planlægger & Kalender.</h2>
        </div>

        {/* Horizontal Week Calendar */}
        <div className="px-8 md:px-12 mb-10 w-full max-w-4xl">
          <div className="flex justify-between">
            {week.map((date, idx) => {
              const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth();
              const rawWeekday = date.toLocaleDateString('da-DK', { weekday: 'short' }).replace('.', '');
              const weekdayLabel = rawWeekday.charAt(0).toUpperCase() + rawWeekday.slice(1);

              return (
                <div key={idx} className="flex flex-col items-center space-y-3 cursor-pointer group">
                  <span className="text-sm font-medium text-gray-400 group-hover:text-gray-600 transition-colors">
                    {weekdayLabel}
                  </span>
                  <div className={`
                    w-12 h-12 flex items-center justify-center rounded-full text-base font-semibold transition-all shadow-sm
                    ${isToday 
                      ? 'bg-[#1a3b2b] text-white scale-110 shadow-md' 
                      : 'bg-white text-gray-600 group-hover:bg-gray-100'}
                  `}>
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Layout Grid */}
        <div className="flex-1 bg-white rounded-t-[50px] shadow-inner p-8 md:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 h-full">
            
            {/* DAILY SCHEDULE SECTION */}
            <div>
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-bold text-gray-900">Dagens tidsplan</h3>
                <button 
                  onClick={() => setIsAddingSchedule(!isAddingSchedule)}
                  className="text-sm font-medium text-[#1a3b2b] bg-[#eef5ef] px-4 py-2 rounded-full flex items-center hover:bg-[#dce9df] transition-colors"
                >
                  <Plus size={18} className="mr-1.5" /> Tilføj aftale
                </button>
              </div>

              {isAddingSchedule && (
                <form onSubmit={handleAddSchedule} className="mb-8 p-5 bg-gray-50 rounded-2xl border border-gray-100 shadow-sm flex flex-col space-y-4">
                  <input 
                    type="text" 
                    value={newScheduleTitle}
                    onChange={(e) => setNewScheduleTitle(e.target.value)}
                    placeholder="Titel på aftale (f.eks. Frokost)..." 
                    className="bg-white px-5 py-3 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
                    autoFocus
                  />
                  <div className="flex flex-wrap sm:flex-nowrap items-end gap-3">
                    <div className="flex-1 min-w-[110px]">
                      <label className="block text-xs font-semibold text-gray-500 mb-1 ml-1">Start</label>
                      <input 
                        type="time" 
                        value={newScheduleStartTime}
                        onChange={(e) => setNewScheduleStartTime(e.target.value)}
                        className="w-full bg-white px-4 py-2.5 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
                      />
                    </div>
                    <div className="flex-1 min-w-[110px]">
                      <label className="block text-xs font-semibold text-gray-500 mb-1 ml-1">Slut</label>
                      <input 
                        type="time" 
                        value={newScheduleEndTime}
                        onChange={(e) => setNewScheduleEndTime(e.target.value)}
                        className="w-full bg-white px-4 py-2.5 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
                      />
                    </div>
                    <button type="submit" className="bg-[#1a3b2b] text-white px-6 py-2.5 rounded-xl text-base font-medium hover:bg-black transition-colors shrink-0">
                      Gem
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-8 relative before:absolute before:inset-0 before:ml-[40px] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
                
                {schedule.length === 0 && !isAddingSchedule && (
                  <p className="text-base text-gray-400 text-center italic py-6">Ingen aftaler planlagt i dag.</p>
                )}

                {schedule.map((event) => {
                  const isEditing = editingScheduleId === event.id;

                  return (
                    <div key={event.id} className="relative flex items-center group">
                      <div className="flex items-center justify-center w-20 shrink-0 text-sm font-bold text-gray-800 z-10 bg-white">
                        {event.time}
                      </div>
                      
                      <div className={`relative flex-1 p-5 rounded-3xl border ${event.color} ml-6 shadow-sm transition-all ${!isEditing ? 'hover:-translate-y-1 hover:shadow-md' : ''}`}>
                        {isEditing ? (
                          <form onSubmit={handleUpdateSchedule} className="space-y-3">
                            <input
                              type="text"
                              value={editScheduleTitle}
                              onChange={(e) => setEditScheduleTitle(e.target.value)}
                              className="w-full bg-white/90 text-gray-900 px-3.5 py-2 rounded-xl text-base font-medium focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
                              placeholder="Titel på aftale..."
                              autoFocus
                            />
                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                              <div className="flex items-center space-x-2 flex-1">
                                <input
                                  type="time"
                                  value={editScheduleStartTime}
                                  onChange={(e) => setEditScheduleStartTime(e.target.value)}
                                  className="bg-white/90 text-gray-900 px-3 py-1.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
                                />
                                <span className="text-sm font-medium opacity-70">-</span>
                                <input
                                  type="time"
                                  value={editScheduleEndTime}
                                  onChange={(e) => setEditScheduleEndTime(e.target.value)}
                                  className="bg-white/90 text-gray-900 px-3 py-1.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
                                />
                              </div>
                              <div className="flex items-center space-x-1.5 ml-auto">
                                <button
                                  type="submit"
                                  className="p-2 bg-[#1a3b2b] text-white rounded-xl hover:bg-black transition-colors"
                                  title="Gem ændringer"
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditingSchedule}
                                  className="p-2 bg-white/80 text-gray-700 rounded-xl hover:bg-white transition-colors"
                                  title="Annuller"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="absolute top-4 right-4 flex items-center space-x-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => startEditingSchedule(event)}
                                className="p-1.5 rounded-full hover:bg-black/5 text-black/50 hover:text-black transition-colors"
                                title="Rediger aftale"
                              >
                                <Pencil size={16} />
                              </button>
                              <button 
                                onClick={() => deleteSchedule(event.id)}
                                className="p-1.5 rounded-full hover:bg-black/5 text-black/50 hover:text-red-600 transition-colors"
                                title="Slet aftale"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <h4 className="font-semibold text-lg pr-14">{event.title}</h4>
                            <div className="flex items-center text-sm opacity-75 mt-2 font-medium">
                              <Clock size={14} className="mr-1.5" />
                              <span>
                                {event.time}{event.endTime ? ` - ${event.endTime}` : ''}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TO-DO LIST SECTION (Cloud Synced) */}
            <div>
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">Opgaveliste</h3>
                  <p className="text-sm text-gray-400 mt-1">Gemt i skyen</p>
                </div>
                <button 
                  onClick={() => setIsAddingTask(!isAddingTask)}
                  className="text-sm font-medium text-white bg-[#1a3b2b] px-5 py-2.5 rounded-full flex items-center shadow-md hover:bg-black transition-colors"
                >
                  <Plus size={18} className="mr-1.5" /> Opgave
                </button>
              </div>

              {/* Add Task Form */}
              {isAddingTask && (
                <form onSubmit={handleAddTodo} className="mb-8 p-5 bg-[#eef5ef]/50 rounded-3xl shadow-sm border border-[#1a3b2b]/10 flex flex-col space-y-4">
                  <input
                    type="text"
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    placeholder="Hvad skal gøres?"
                    className="w-full bg-white px-5 py-3 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
                    autoFocus
                  />
                  <div className="flex justify-between items-center">
                    <div className="flex space-x-3">
                      <button
                        type="button"
                        onClick={() => setNewTaskType('personal')}
                        className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center transition-all ${
                          newTaskType === 'personal' 
                          ? 'bg-pink-100 text-pink-700 border border-pink-200 shadow-sm' 
                          : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50'
                        }`}
                      >
                        <UserIcon size={16} className="mr-2" /> Privat
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewTaskType('work')}
                        className={`px-5 py-2.5 rounded-xl text-sm font-bold flex items-center transition-all ${
                          newTaskType === 'work' 
                          ? 'bg-blue-100 text-blue-700 border border-blue-200 shadow-sm' 
                          : 'bg-white text-gray-400 border border-gray-100 hover:bg-gray-50'
                        }`}
                      >
                        <Briefcase size={16} className="mr-2" /> Arbejde
                      </button>
                    </div>
                    <button type="submit" className="bg-[#1a3b2b] text-white p-3 rounded-xl shadow-md hover:bg-black transition-colors" title="Tilføj opgave">
                      <Plus size={20} />
                    </button>
                  </div>
                </form>
              )}

              {/* Task Lists */}
              <div className="space-y-10">
                
                {/* Personal Tasks */}
                {personalTodos.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider text-pink-400 mb-4 flex items-center">
                      <UserIcon size={16} className="mr-2" /> Privat
                    </h4>
                    <div className="space-y-4">
                      {personalTodos.map(todo => (
                        <TaskCard 
                          key={todo.id} 
                          todo={todo} 
                          onToggle={toggleTodo} 
                          onDelete={deleteTodo}
                          isEditing={editingTodoId === todo.id}
                          editText={editTodoText}
                          setEditText={setEditTodoText}
                          editType={editTodoType}
                          setEditType={setEditTodoType}
                          onStartEdit={startEditingTodo}
                          onCancelEdit={cancelEditingTodo}
                          onSaveEdit={handleUpdateTodo}
                          colorClass="bg-pink-50 border-pink-100 text-pink-900" 
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Work Tasks */}
                {workTodos.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider text-blue-400 mb-4 flex items-center">
                      <Briefcase size={16} className="mr-2" /> Arbejde
                    </h4>
                    <div className="space-y-4">
                      {workTodos.map(todo => (
                        <TaskCard 
                          key={todo.id} 
                          todo={todo} 
                          onToggle={toggleTodo} 
                          onDelete={deleteTodo}
                          isEditing={editingTodoId === todo.id}
                          editText={editTodoText}
                          setEditText={setEditTodoText}
                          editType={editTodoType}
                          setEditType={setEditTodoType}
                          onStartEdit={startEditingTodo}
                          onCancelEdit={cancelEditingTodo}
                          onSaveEdit={handleUpdateTodo}
                          colorClass="bg-blue-50 border-blue-100 text-blue-900" 
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Completed Tasks */}
                {completedTodos.length > 0 && (
                  <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">Fuldført</h4>
                    <div className="space-y-4">
                      {completedTodos.map(todo => (
                        <TaskCard 
                          key={todo.id} 
                          todo={todo} 
                          onToggle={toggleTodo} 
                          onDelete={deleteTodo}
                          isEditing={editingTodoId === todo.id}
                          editText={editTodoText}
                          setEditText={setEditTodoText}
                          editType={editTodoType}
                          setEditType={setEditTodoType}
                          onStartEdit={startEditingTodo}
                          onCancelEdit={cancelEditingTodo}
                          onSaveEdit={handleUpdateTodo}
                          colorClass="bg-gray-50 border-gray-100 text-gray-400 line-through" 
                          isCompleted 
                        />
                      ))}
                    </div>
                  </div>
                )}

                {todos.length === 0 && !isAddingTask && (
                  <div className="text-center py-12 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                    <p className="text-gray-400 text-base">Din opgaveliste er tom.</p>
                    <p className="text-gray-400 text-sm mt-2">Tilføj en opgave for at komme i gang.</p>
                  </div>
                )}

              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// Sub-component for individual tasks to keep code clean
function TaskCard({ 
  todo, 
  onToggle, 
  onDelete, 
  colorClass, 
  isCompleted = false,
  isEditing = false,
  editText = '',
  setEditText,
  editType = 'personal',
  setEditType,
  onStartEdit,
  onCancelEdit,
  onSaveEdit
}) {
  if (isEditing) {
    return (
      <form onSubmit={onSaveEdit} className={`p-4 rounded-2xl border shadow-sm space-y-3 ${colorClass}`}>
        <input
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          placeholder="Opgavetekst..."
          className="w-full bg-white/90 text-gray-900 px-3.5 py-2 rounded-xl text-base font-medium focus:outline-none focus:ring-2 focus:ring-[#1a3b2b]"
          autoFocus
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setEditType('personal')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center transition-all ${
                editType === 'personal'
                  ? 'bg-pink-200/80 text-pink-900 border border-pink-300'
                  : 'bg-white/70 text-gray-500 hover:bg-white'
              }`}
            >
              <UserIcon size={14} className="mr-1.5" /> Privat
            </button>
            <button
              type="button"
              onClick={() => setEditType('work')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center transition-all ${
                editType === 'work'
                  ? 'bg-blue-200/80 text-blue-900 border border-blue-300'
                  : 'bg-white/70 text-gray-500 hover:bg-white'
              }`}
            >
              <Briefcase size={14} className="mr-1.5" /> Arbejde
            </button>
          </div>
          <div className="flex items-center space-x-1.5 ml-auto">
            <button
              type="submit"
              className="p-2 bg-[#1a3b2b] text-white rounded-xl hover:bg-black transition-colors"
              title="Gem ændringer"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="p-2 bg-white/80 text-gray-700 rounded-xl hover:bg-white transition-colors"
              title="Annuller"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className={`flex items-center justify-between p-5 rounded-2xl border transition-all shadow-sm hover:shadow-md group ${colorClass}`}>
      <div className="flex items-center flex-1 cursor-pointer overflow-hidden" onClick={() => onToggle(todo)}>
        <button className="mr-4 shrink-0 focus:outline-none">
          {isCompleted ? (
            <CheckCircle2 size={24} className="text-[#1a3b2b]" />
          ) : (
            <Circle size={24} className="opacity-40 hover:opacity-100 transition-opacity" />
          )}
        </button>
        <span className="font-medium text-base truncate pr-4">{todo.text}</span>
      </div>
      <div className="flex items-center space-x-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
        <button 
          onClick={() => onStartEdit(todo)}
          className="text-gray-500 hover:text-gray-900 p-2 rounded-full hover:bg-black/5 transition-colors focus:outline-none"
          title="Rediger opgave"
        >
          <Pencil size={17} />
        </button>
        <button 
          onClick={() => onDelete(todo.id)}
          className="text-gray-500 hover:text-red-500 p-2 rounded-full hover:bg-black/5 transition-colors focus:outline-none"
          title="Slet opgave"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}