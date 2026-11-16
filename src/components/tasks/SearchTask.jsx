import { months, parseFormDate } from "../../scripts/utils.js";
import { Link } from "react-router-dom";
import { closeForm } from "../../scripts/utils.js";

export default function SearchTask({ data }) {

    const MAX_TASK_NAME_LENGTH = 20;

    const taskDate = parseFormDate(data.date);
    const validDate = taskDate && !isNaN(taskDate.getTime());

    let searchParams = `openedTask=${data.id}`;
    if (validDate) {
        const today = new Date();
        taskDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const dayDiff = Math.floor((taskDate - today) / (1000 * 60 * 60 * 24));
        const taskDayOfWeek = taskDate.getDay();
        const todayDayOfWeek = today.getDay();
        let weekShift = Math.floor((dayDiff - todayDayOfWeek) / 7);
        if (taskDayOfWeek <= todayDayOfWeek + 1) {
            ++weekShift;
        }
        searchParams = `weekShift=${weekShift}&openedTask=${data.id}`;
    }

    function handleClick() {
        closeForm("search-form");
        document.getElementById("search-task-name").value = "";
        document.querySelector(".clear-search").classList.add("hidden");
    }

    const dateLabel = validDate
        ? `${taskDate.getDate()} ${months[taskDate.getMonth()].slice(0, 3)}.`
        : data.date || '';

    return (
        <Link to={`/?${searchParams}`} className={`w-full border-b
         border-gray-200 hover:border-gray-500 hover:border-b-0 group`} onClick={handleClick}>
            <div className="task flex justify-between items-center py-2 px-3 cursor-pointer">
                <h5 className={`task-title px-2 py-0.5 rounded-full text-sm bg-${data.color} ` + (data.done ? "opacity-40 line-through " : '')}
                >{ data.description && <i className="fa-regular fa-note-sticky"></i> } {(data.name || '').slice(0, MAX_TASK_NAME_LENGTH) +
                    ((data.name || '').length > MAX_TASK_NAME_LENGTH ? "..." : "")}</h5>
                <p className="text-gray-400">
                    {dateLabel}
                </p>
            </div>
        </Link>
    )
}
