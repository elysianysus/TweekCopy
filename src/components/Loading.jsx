export default function Loading({ text }) {
    return (
        <div className="w-full dark:text-white h-screen py-20 flex flex-col justify-center items-center">
            <h2 className="text-2xl font-bold">Loading {text}...</h2>
            <i className="fa-regular fa-note-sticky fa-bounce text-6xl"></i>
        </div>
    );
}
