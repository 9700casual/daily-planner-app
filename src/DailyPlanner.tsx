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
  X,
  LogOut
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
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
// Uses VITE_FIREBASE_* env vars when configured; falls back to localStorage locally.
const appId = import.meta.env.VITE_FIREBASE_APP_ID || 'vibe-planner-app';
const firebaseConfig = import.meta.env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    }
  : null;

const isFirebaseEnabled = Boolean(firebaseConfig);
const LOCAL_TODOS_KEY = 'daily-planner-todos';
const LOCAL_SCHEDULE_KEY = 'daily-planner-schedule';

let app, auth, db;
if (isFirebaseEnabled && firebaseConfig) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    console.error("Firebase init error:", e);
  }
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
  const [authLoading, setAuthLoading] = useState(isFirebaseEnabled);
  const [authError, setAuthError] = useState('');
  const [syncError, setSyncError] = useState('');
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
    if (!isFirebaseEnabled || !auth) {
      setUser({ uid: 'local-user' });
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    if (!auth) return;
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google Sign-In Error:", error);
      setAuthError('Kunne ikke logge ind med Google. Tjek at Google-login og domænet er aktiveret i Firebase.');
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      setTodos([]);
      setSchedule([]);
    } catch (error) {
      console.error("Sign-Out Error:", error);
    }
  };

  // --- Cloud / Local Sync for To-Dos ---
  useEffect(() => {
    if (!user) return;

    if (!isFirebaseEnabled || !db) {
      try {
        const saved = JSON.parse(localStorage.getItem(LOCAL_TODOS_KEY) || '[]');
        saved.sort((a, b) => b.createdAt - a.createdAt);
        setTodos(saved);
      } catch (e) {
        console.error("LocalStorage todos read error:", e);
      }
      return;
    }

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
      setSyncError(`Firestore-fejl (to-dos): ${error?.message || error}`);
    });

    return () => unsubscribe();
  }, [user]);

  // --- Cloud / Local Sync for Schedule ---
  useEffect(() => {
    if (!user) return;

    if (!isFirebaseEnabled || !db) {
      try {
        const todayStr = new Date().toDateString();
        const saved = JSON.parse(localStorage.getItem(LOCAL_SCHEDULE_KEY) || '[]');
        const todaysSchedule = saved.filter(item => item.date === todayStr);
        todaysSchedule.sort((a, b) => a.time.localeCompare(b.time));
        if (todaysSchedule.length !== saved.length) {
          localStorage.setItem(LOCAL_SCHEDULE_KEY, JSON.stringify(todaysSchedule));
        }
        setSchedule(todaysSchedule);
      } catch (e) {
        console.error("LocalStorage schedule read error:", e);
      }
      return;
    }

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
      setSyncError(`Firestore-fejl (to-dos): ${error?.message || error}`);
    });

    return () => unsubscribe();
  }, [user]);

  // --- To-Do Actions ---
  const saveLocalTodos = (nextTodos) => {
    const sorted = [...nextTodos].sort((a, b) => b.createdAt - a.createdAt);
    localStorage.setItem(LOCAL_TODOS_KEY, JSON.stringify(sorted));
    setTodos(sorted);
  };

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!user || !newTaskText.trim()) return;

    const newItem = {
      text: newTaskText.trim(),
      type: newTaskType,
      completed: false,
      createdAt: Date.now()
    };

    if (!isFirebaseEnabled || !db) {
      saveLocalTodos([{ id: crypto.randomUUID(), ...newItem }, ...todos]);
      setNewTaskText('');
      setIsAddingTask(false);
      return;
    }

    try {
      setSyncError('');
      const todosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'todos');
      await addDoc(todosRef, newItem);
      setNewTaskText('');
      setIsAddingTask(false);
    } catch (error) {
      console.error("Error adding todo:", error);
      setSyncError(`Kunne ikke gemme opgave: ${error?.message || error}`);
    }
  };

  const toggleTodo = async (todo) => {
    if (!user) return;
    if (!isFirebaseEnabled || !db) {
      saveLocalTodos(
        todos.map(t => (t.id === todo.id ? { ...t, completed: !t.completed } : t))
      );
      return;
    }
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
    if (!isFirebaseEnabled || !db) {
      saveLocalTodos(todos.filter(t => t.id !== id));
      return;
    }
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

    if (!isFirebaseEnabled || !db) {
      saveLocalTodos(
        todos.map(t =>
          t.id === editingTodoId
            ? { ...t, text: editTodoText.trim(), type: editTodoType }
            : t
        )
      );
      cancelEditingTodo();
      return;
    }

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

  // --- Schedule Actions (Cloud / Local Synced) ---
  const saveLocalSchedule = (nextSchedule) => {
    const sorted = [...nextSchedule].sort((a, b) => a.time.localeCompare(b.time));
    localStorage.setItem(LOCAL_SCHEDULE_KEY, JSON.stringify(sorted));
    setSchedule(sorted);
  };

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

    const newEvent = {
      time: newScheduleStartTime,
      endTime: newScheduleEndTime,
      title: newScheduleTitle.trim(),
      duration: 'Scheduled',
      color: randomColor,
      date: new Date().toDateString(),
      createdAt: Date.now()
    };

    if (!isFirebaseEnabled || !db) {
      saveLocalSchedule([...schedule, { id: crypto.randomUUID(), ...newEvent }]);
      setNewScheduleTitle('');
      setIsAddingSchedule(false);
      return;
    }

    try {
      const scheduleRef = collection(db, 'artifacts', appId, 'users', user.uid, 'schedule');
      await addDoc(scheduleRef, newEvent);
      
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

    if (!isFirebaseEnabled || !db) {
      saveLocalSchedule(
        schedule.map(ev =>
          ev.id === editingScheduleId
            ? {
                ...ev,
                title: editScheduleTitle.trim(),
                time: editScheduleStartTime,
                endTime: editScheduleEndTime
              }
            : ev
        )
      );
      cancelEditingSchedule();
      return;
    }

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
    if (!isFirebaseEnabled || !db) {
      saveLocalSchedule(schedule.filter(ev => ev.id !== id));
      return;
    }
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

  if (isFirebaseEnabled && authLoading) {
    return (
      <div className="min-h-screen bg-[#eef5ef] flex items-center justify-center font-sans text-gray-600">
        <div className="bg-[#f6fbf6] px-8 py-6 rounded-3xl shadow-lg text-sm font-medium">
          Indlæser din planlægger...
        </div>
      </div>
    );
  }

  if (isFirebaseEnabled && !user) {
    return (
      <div className="min-h-screen bg-[#eef5ef] p-4 flex items-center justify-center font-sans text-gray-800">
        <div className="w-full max-w-md bg-[#f6fbf6] rounded-[40px] shadow-2xl p-10 text-center">
          <div className="w-14 h-14 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-6">
            <CalendarIcon size={28} className="text-gray-700" />
          </div>
          <h1 className="text-3xl font-light text-gray-600">Din daglige</h1>
          <h2 className="text-4xl font-bold text-gray-900 tracking-tight mt-1 mb-4">Planlægger.</h2>
          <p className="text-sm text-gray-500 mb-8">
            Log ind med Google for at synkronisere dine opgaver og din tidsplan på tværs af enheder.
          </p>

          {authError && (
            <div className="mb-4 p-3 rounded-2xl bg-red-50 text-red-700 text-xs border border-red-100">
              {authError}
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            className="w-full py-3.5 px-6 bg-white hover:bg-gray-50 text-gray-800 font-medium rounded-2xl shadow-sm border border-gray-200 flex items-center justify-center gap-3 transition-all cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Fortsæt med Google</span>
          </button>
        </div>
      </div>
    );
  }

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
            <div className="flex items-center space-x-3">
              {isFirebaseEnabled && user && (
                <button
                  onClick={handleSignOut}
                  title="Log ud"
                  className="flex items-center space-x-2 bg-white px-4 py-2.5 rounded-full shadow-sm text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'Bruger'}
                      className="w-5 h-5 rounded-full"
                    />
                  )}
                  <span className="hidden sm:inline">{user.displayName || user.email || 'Log ud'}</span>
                  <LogOut size={16} className="text-gray-500" />
                </button>
              )}
              <div className="flex items-center space-x-2 bg-white px-5 py-2.5 rounded-full shadow-sm text-sm font-medium">
                <span>{capitalizedMonthYear}</span>
                <CalendarIcon size={18} className="text-gray-500" />
              </div>
            </div>
          </div>

          <h1 className="text-4xl font-light text-gray-600">Din daglige</h1>
          <h2 className="text-5xl font-bold text-gray-900 tracking-tight mt-2">Planlægger & Kalender.</h2>
          {syncError && (
            <div className="mt-4 p-3 rounded-2xl bg-red-50 text-red-700 text-sm border border-red-200">
              {syncError}
            </div>
          )}
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